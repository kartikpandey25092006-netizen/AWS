import importlib.util
import json
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock


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


def request_event(method, path, body=None):
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
        "body": body,
    }


class ApiHandlerTests(unittest.TestCase):
    def setUp(self):
        self.cloudwatch = Mock()
        self.cloudwatch.describe_alarms.return_value = {
            "MetricAlarms": [{"AlarmName": "self-healing-high-cpu"}]
        }
        api.cloudwatch = self.cloudwatch

    def response_body(self, response):
        return json.loads(response["body"])

    def test_invalid_json_is_rejected_without_changing_alarms(self):
        response = api.handler(request_event("POST", "/api/maintenance", "{"), None)

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
                    request_event(
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
            request_event("POST", "/api/maintenance", json.dumps({"maintenance": True})),
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
            request_event("POST", "/api/maintenance", json.dumps({"maintenance": True})),
            None,
        )

        self.assertEqual(response["statusCode"], 500)
        self.assertNotIn("private detail", response["body"])
        self.assertEqual(
            self.response_body(response),
            {"error": "The request could not be completed."},
        )


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


if __name__ == "__main__":
    unittest.main()
