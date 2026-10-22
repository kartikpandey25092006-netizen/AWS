import importlib.util
import json
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
API_PATH = PROJECT_ROOT / "lambda" / "api.py"


def load_api_module():
    boto3_stub = types.ModuleType("boto3")
    boto3_stub.__path__ = []
    boto3_stub.client = lambda *args, **kwargs: object()
    boto3_stub.resource = lambda *args, **kwargs: types.SimpleNamespace(
        Table=lambda name: object()
    )

    dynamodb_module = types.ModuleType("boto3.dynamodb")
    dynamodb_module.__path__ = []
    conditions_module = types.ModuleType("boto3.dynamodb.conditions")
    conditions_module.Key = lambda name: None
    dynamodb_module.conditions = conditions_module
    boto3_stub.dynamodb = dynamodb_module

    stubs = {
        "boto3": boto3_stub,
        "boto3.dynamodb": dynamodb_module,
        "boto3.dynamodb.conditions": conditions_module,
    }
    previous_modules = {name: sys.modules.get(name) for name in stubs}
    sys.modules.update(stubs)
    try:
        spec = importlib.util.spec_from_file_location("cloudops_api_under_test", API_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, previous in previous_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


api = load_api_module()


def request_event(method, path, body=None, claims=None):
    event = {
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
        "body": body,
    }
    if claims is not None:
        event["requestContext"]["authorizer"] = {"jwt": {"claims": claims}}
    return event


def admin_request_event(method, path, body=None):
    return request_event(
        method,
        path,
        body,
        claims={"sub": "admin-subject", "cognito:groups": ["store-admin"]},
    )


class ApiHandlerTests(unittest.TestCase):
    def setUp(self):
        api.get_instance_private_dns.cache_clear()
        self.cloudwatch = Mock()
        self.cloudwatch.describe_alarms.return_value = {
            "MetricAlarms": [{"AlarmName": "self-healing-high-cpu"}]
        }
        api.cloudwatch = self.cloudwatch
        self.ec2 = Mock()
        self.dynamodb = Mock()
        api.ec2 = self.ec2
        api.dynamodb = self.dynamodb

    def response_body(self, response):
        return json.loads(response["body"])

    def test_invalid_json_is_rejected_without_changing_alarms(self):
        response = api.handler(admin_request_event("POST", "/api/maintenance", "{"), None)

        self.assertEqual(response["statusCode"], 400)
        self.assertEqual(
            self.response_body(response),
            {"error": "Request body must be valid JSON."},
        )
        self.cloudwatch.describe_alarms.assert_not_called()

    def test_maintenance_requires_a_boolean_field(self):
        invalid_values = ["true", "false", 1, 0, None, [], {"enabled": True}]

        for value in invalid_values:
            with self.subTest(value=value):
                response = api.handler(
                    admin_request_event(
                        "POST",
                        "/api/maintenance",
                        json.dumps({"maintenance": value}),
                    ),
                    None,
                )
                self.assertEqual(response["statusCode"], 400)

        self.cloudwatch.describe_alarms.assert_not_called()

    def test_valid_maintenance_request_disables_alarm_actions(self):
        response = api.handler(
            admin_request_event("POST", "/api/maintenance", json.dumps({"maintenance": True})),
            None,
        )

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(self.response_body(response)["maintenance"], True)
        self.cloudwatch.disable_alarm_actions.assert_called_once_with(
            AlarmNames=["self-healing-high-cpu"]
        )

    def test_unknown_path_returns_not_found(self):
        response = api.handler(request_event("GET", "/api/unknown"), None)

        self.assertEqual(response["statusCode"], 404)
        self.assertEqual(self.response_body(response), {"error": "Not found."})

    def test_wrong_method_returns_method_not_allowed(self):
        response = api.handler(request_event("GET", "/api/maintenance"), None)

        self.assertEqual(response["statusCode"], 405)
        self.assertEqual(
            self.response_body(response),
            {"error": "Method not allowed."},
        )
        self.cloudwatch.describe_alarms.assert_not_called()

    def test_internal_error_does_not_leak_exception_details(self):
        self.cloudwatch.describe_alarms.side_effect = RuntimeError("private detail")
        response = api.handler(
            admin_request_event("POST", "/api/maintenance", json.dumps({"maintenance": True})),
            None,
        )

        self.assertEqual(response["statusCode"], 500)
        self.assertNotIn("private detail", response["body"])
        self.assertEqual(
            self.response_body(response),
            {"error": "The request could not be completed."},
        )

    def assert_no_aws_calls(self):
        self.assertEqual(self.cloudwatch.mock_calls, [])
        self.assertEqual(self.ec2.mock_calls, [])
        self.assertEqual(self.dynamodb.mock_calls, [])

    def protected_events(self, claims=None):
        return [
            request_event("GET", "/api/session", claims=claims),
            request_event("GET", "/api/status", claims=claims),
            request_event("POST", "/api/maintenance", "{", claims=claims),
        ]

    def test_protected_routes_require_trusted_authorizer_claims(self):
        for event in self.protected_events():
            with self.subTest(path=event["rawPath"]):
                response = api.handler(event, None)
                self.assertEqual(response["statusCode"], 401)
                self.assertEqual(
                    self.response_body(response),
                    {"error": "Authentication is required."},
                )
        self.assert_no_aws_calls()

    def test_malformed_authorizer_context_is_rejected(self):
        authorizers = [
            None,
            [],
            "store-admin",
            {},
            {"jwt": None},
            {"jwt": []},
            {"jwt": {"claims": None}},
            {"jwt": {"claims": []}},
            {"jwt": {"claims": "store-admin"}},
            {"claims": {"sub": "subject", "cognito:groups": ["store-admin"]}},
        ]
        for authorizer in authorizers:
            for event in self.protected_events():
                with self.subTest(authorizer=authorizer, path=event["rawPath"]):
                    event["requestContext"]["authorizer"] = authorizer
                    response = api.handler(event, None)
                    self.assertEqual(response["statusCode"], 401)
        self.assert_no_aws_calls()

    def test_missing_or_malformed_subject_is_rejected(self):
        for subject in (None, "", " ", 123, [], {}):
            claims = {"sub": subject, "cognito:groups": ["store-admin"]}
            for event in self.protected_events(claims):
                with self.subTest(subject=subject, path=event["rawPath"]):
                    self.assertEqual(api.handler(event, None)["statusCode"], 401)
        self.assert_no_aws_calls()

    def test_missing_or_malformed_request_context_is_rejected(self):
        for request_context in (None, "store-admin", []):
            event = request_event("GET", "/api/session")
            event["requestContext"] = request_context
            with self.subTest(request_context=request_context):
                self.assertEqual(api.handler(event, None)["statusCode"], 401)
        self.assert_no_aws_calls()

    def test_customer_or_lookalike_groups_cannot_access_protected_routes(self):
        invalid_groups = [
            None, "", [], ["customer"], ["store-admins"], ["not-store-admin"],
            ["Store-admin"], ["store-admin "], ["[store-admin]"],
            "customer,store-admin", "[customer,store-admin]", "store-admins",
            "[customer store-admins]", "[[store-admin]]", '["store-admins"]',
            '"store-admin"', {"store-admin": True}, True, 1,
            ["store-admin", None], ["store-admin", {"group": "customer"}],
        ]
        for groups in invalid_groups:
            claims = {"sub": "customer-subject", "cognito:groups": groups}
            for event in self.protected_events(claims):
                with self.subTest(groups=groups, path=event["rawPath"]):
                    response = api.handler(event, None)
                    self.assertEqual(response["statusCode"], 403)
                    self.assertEqual(
                        self.response_body(response),
                        {"error": "Administrator access is required."},
                    )
        self.assert_no_aws_calls()

    def test_admin_role_email_and_iam_claims_do_not_replace_group_membership(self):
        claims = {
            "sub": "customer-subject",
            "role": "admin",
            "custom:role": "store-admin",
            "email": "admin@example.com",
            "cognito:roles": ["store-admin"],
            "cognito:preferred_role": "store-admin",
        }
        for event in self.protected_events(claims):
            with self.subTest(path=event["rawPath"]):
                self.assertEqual(api.handler(event, None)["statusCode"], 403)
        self.assert_no_aws_calls()

    def test_forged_headers_body_and_unverified_tokens_are_ignored(self):
        for claims, expected_status in ((None, 401), ({"sub": "customer"}, 403)):
            for event in self.protected_events(claims):
                with self.subTest(claims=claims, path=event["rawPath"]):
                    event["headers"] = {
                        "Authorization": "Bearer fake.eyJjb2duaXRvOmdyb3VwcyI6WyJzdG9yZS1hZG1pbiJdfQ.fake",
                        "x-role": "admin",
                        "cognito:groups": "store-admin",
                    }
                    event["claims"] = {"sub": "admin", "cognito:groups": ["store-admin"]}
                    event["body"] = json.dumps({"maintenance": True, "role": "admin"})
                    self.assertEqual(api.handler(event, None)["statusCode"], expected_status)
        self.assert_no_aws_calls()

    def test_session_approves_only_exact_admin_groups_without_aws_calls(self):
        accepted_groups = [
            ["store-admin"], ["customer", "store-admin"], "store-admin",
            '["store-admin"]', '["customer", "store-admin"]',
            "[store-admin]", "[customer store-admin]",
        ]
        for groups in accepted_groups:
            with self.subTest(groups=groups):
                event = request_event(
                    "GET", "/api/session",
                    claims={"sub": "admin-subject", "cognito:groups": groups},
                )
                response = api.handler(event, None)
                self.assertEqual(response["statusCode"], 200)
                self.assertEqual(self.response_body(response), {"role": "store-admin"})
                self.assertEqual(response["headers"]["Cache-Control"], "no-store")
        self.assert_no_aws_calls()

    def test_authorized_admin_can_read_status(self):
        with (
            patch.object(api, "get_uptime", return_value=3600),
            patch.object(api, "get_cpu_metrics", return_value=([], 0, False)),
            patch.object(api, "get_memory_metrics", return_value=([], 0, False)),
            patch.object(api, "get_audit_logs", return_value=[]),
            patch.object(api, "get_healing_state", return_value={}),
        ):
            response = api.handler(admin_request_event("GET", "/api/status"), None)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(self.response_body(response)["uptime"], 3600)
        self.cloudwatch.describe_alarms.assert_called_once_with(AlarmNamePrefix="self-healing")

    def test_missing_memory_does_not_produce_a_health_score(self):
        with (
            patch.object(api, "get_uptime", return_value=3600),
            patch.object(api, "get_cpu_metrics", return_value=([], 7, False)),
            patch.object(api, "get_memory_metrics", return_value=([], None, False)),
            patch.object(api, "get_audit_logs", return_value=[]),
            patch.object(api, "get_healing_state", return_value={}),
        ):
            response = api.handler(admin_request_event("GET", "/api/status"), None)

        self.assertEqual(response["statusCode"], 200)
        body = self.response_body(response)
        self.assertIsNone(body["current_memory"])
        self.assertIsNone(body["health_score"])

    def test_authorized_admin_can_resume_alarm_actions(self):
        response = api.handler(
            admin_request_event("POST", "/api/maintenance", json.dumps({"maintenance": False})),
            None,
        )
        self.assertEqual(response["statusCode"], 200)
        self.cloudwatch.enable_alarm_actions.assert_called_once_with(
            AlarmNames=["self-healing-high-cpu"]
        )

    def test_unknown_path_and_wrong_methods_do_not_call_aws(self):
        for method, path, status in (
            ("GET", "/api/unknown", 404),
            ("POST", "/api/status", 405),
            ("GET", "/api/maintenance", 405),
            ("POST", "/api/session", 405),
        ):
            with self.subTest(method=method, path=path):
                response = api.handler(request_event(method, path), None)
                self.assertEqual(response["statusCode"], status)
        self.assert_no_aws_calls()


class HealthScoreTests(unittest.TestCase):
    def test_healthy_inputs_produce_full_score(self):
        result = api.compute_health_score(
            cpu=0,
            memory=0,
            uptime_seconds=3600,
            cpu_history=[],
            memory_history=[],
            healing_state={},
        )

        self.assertEqual(result["overall"], 100)
        self.assertEqual(result["grade"], "A")

    def test_degraded_inputs_score_below_healthy_inputs(self):
        healthy = api.compute_health_score(0, 0, 3600, [], [], {})
        degraded = api.compute_health_score(
            100,
            100,
            0,
            [],
            [],
            {"app-health": {"status": "RECOVERING", "attempts": 3}},
        )

        self.assertGreaterEqual(degraded["overall"], 0)
        self.assertLess(degraded["overall"], healthy["overall"])


class MetricThresholdTests(unittest.TestCase):
    def test_memory_alarm_indicator_matches_sixty_percent_alarm(self):
        api.cloudwatch = Mock()
        api.ec2 = Mock()
        api.get_instance_private_dns.cache_clear()
        api.ec2.describe_instances.return_value = {
            "Reservations": [{"Instances": [{"PrivateDnsName": "ip-10-0-0-1.ec2.internal"}]}]
        }
        api.cloudwatch.get_metric_statistics.return_value = {
            "Datapoints": [
                {
                    "Timestamp": datetime.now(timezone.utc) - timedelta(seconds=30),
                    "Average": 60.1,
                }
            ]
        }

        _, current_memory, is_simulating = api.get_memory_metrics("i-example")

        self.assertEqual(current_memory, 60.1)
        self.assertTrue(is_simulating)
        self.assertEqual(
            api.cloudwatch.get_metric_statistics.call_args.kwargs["Dimensions"],
            [{"Name": "host", "Value": "ip-10-0-0-1.ec2.internal"}],
        )

    def test_missing_memory_samples_are_not_reported_as_zero(self):
        api.cloudwatch = Mock()
        api.ec2 = Mock()
        api.get_instance_private_dns.cache_clear()
        api.ec2.describe_instances.return_value = {
            "Reservations": [{"Instances": [{"PrivateDnsName": "ip-10-0-0-1.ec2.internal"}]}]
        }
        api.cloudwatch.get_metric_statistics.return_value = {"Datapoints": []}

        self.assertEqual(api.get_memory_metrics("i-example"), ([], None, False))


class StoreMetricsTests(unittest.TestCase):
    def setUp(self):
        api._get_store_metrics.cache_clear()
        api.cloudwatch = Mock()
        self.minute = 29000000
        self.end = datetime.fromtimestamp(self.minute * 60, timezone.utc)

    def samples(self, requests=10, missing=None, age=1):
        stamp = self.end - timedelta(minutes=age)
        values = {"RequestCount": requests, "ClientErrorCount": 2 if requests else 0,
                  "ServerErrorCount": 1 if requests else 0, "CollectionSeconds": 60,
                  "ResponseDuration": requests * 20}
        def query(**kwargs):
            name = kwargs["MetricName"]
            if name == missing or (name == "ResponseDuration" and not requests):
                return {"Datapoints": []}
            return {"Datapoints": [{"Timestamp": stamp, "Sum": values[name],
                                    "SampleCount": requests if name == "ResponseDuration" else 1}]}
        api.cloudwatch.get_metric_statistics.side_effect = query

    def test_counts_rate_and_weighted_average_use_exact_instance_dimensions(self):
        self.samples()
        result = api._get_store_metrics("i-12345678", self.minute)
        self.assertEqual(result["request_count"], 10)
        self.assertEqual(result["requests_per_minute"], 10)
        self.assertEqual(result["average_response_ms"], 20)
        self.assertEqual(result["server_error_percent"], 10)
        self.assertEqual(result["status"], "partial")
        for call in api.cloudwatch.get_metric_statistics.call_args_list:
            self.assertEqual(call.kwargs["Namespace"], "Fieldwork/StoreApi")
            self.assertEqual(call.kwargs["Dimensions"][1], {"Name": "InstanceId", "Value": "i-12345678"})
        api._get_store_metrics("i-12345678", self.minute)
        self.assertEqual(api.cloudwatch.get_metric_statistics.call_count, 5, "warm minute cache avoids repeated queries")

    def test_idle_is_zero_only_with_complete_counter_and_collection_evidence(self):
        self.samples(requests=0)
        result = api._get_store_metrics("i-12345678", self.minute)
        self.assertEqual(result["request_count"], 0)
        self.assertEqual(result["requests_per_minute"], 0)
        self.assertIsNone(result["average_response_ms"])
        self.assertIsNone(result["server_error_percent"])

    def test_full_window_uses_sample_weighting_not_average_of_averages(self):
        counts = [1, 9, 0, 0, 0]
        durations = [100, 90, 0, 0, 0]
        def query(**kwargs):
            rows = []
            name = kwargs["MetricName"]
            for index, count in enumerate(counts):
                if name == "ResponseDuration" and not count:
                    continue
                value = {"RequestCount": count, "ClientErrorCount": 0,
                         "ServerErrorCount": 0, "CollectionSeconds": 60,
                         "ResponseDuration": durations[index]}[name]
                rows.append({"Timestamp": self.end - timedelta(minutes=index + 1),
                             "Sum": value, "SampleCount": count if name == "ResponseDuration" else 1})
            return {"Datapoints": rows}
        api.cloudwatch.get_metric_statistics.side_effect = query
        result = api._get_store_metrics("i-12345678", self.minute)
        self.assertEqual(result["status"], "available")
        self.assertEqual(result["average_response_ms"], 19)
        self.assertEqual(result["requests_per_minute"], 2)

    def test_missing_counter_and_stale_data_are_distinguished(self):
        self.samples(missing="ServerErrorCount")
        result = api._get_store_metrics("i-12345678", self.minute)
        self.assertEqual(result["status"], "no_data")
        self.assertIsNone(result["request_count"])
        api._get_store_metrics.cache_clear()
        self.samples(age=4)
        self.assertEqual(api._get_store_metrics("i-12345678", self.minute)["status"], "stale")

    def test_no_samples_or_read_failure_does_not_fabricate_healthy_metrics(self):
        api.cloudwatch.get_metric_statistics.return_value = {"Datapoints": []}
        self.assertEqual(api._get_store_metrics("i-12345678", self.minute)["status"], "no_data")
        api._get_store_metrics.cache_clear()
        api.cloudwatch.get_metric_statistics.side_effect = RuntimeError("denied")
        result = api._get_store_metrics("i-12345678", self.minute)
        self.assertEqual(result["status"], "error")
        self.assertIsNone(result["request_count"])

    def test_missing_duration_samples_do_not_report_zero_latency(self):
        self.samples(missing="ResponseDuration")
        result = api._get_store_metrics("i-12345678", self.minute)
        self.assertEqual(result["request_count"], 10)
        self.assertIsNone(result["average_response_ms"])


if __name__ == "__main__":
    unittest.main()
