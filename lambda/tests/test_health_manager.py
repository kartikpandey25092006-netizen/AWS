import importlib.util
import copy
import json
import sys
import types
import unittest
import os
import shlex
import shutil
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch


def load_manager():
    stub = types.ModuleType("boto3")
    stub.client = lambda *args, **kwargs: Mock()
    stub.resource = lambda *args, **kwargs: Mock()
    config_stub = types.ModuleType("botocore.config")
    config_stub.Config = lambda **kwargs: kwargs
    with patch.dict(sys.modules, {"boto3": stub, "botocore.config": config_stub}):
        spec = importlib.util.spec_from_file_location(
            "health_manager_under_test", Path(__file__).resolve().parents[1] / "health_manager.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module


manager = load_manager()


class StoreApiHealthTests(unittest.TestCase):
    def response(self, body, status=200):
        response = Mock()
        response.status = status
        response.read.return_value = body
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        return response

    def test_health_requires_api_json_and_uses_correct_proxy_path(self):
        with patch.object(manager, "get_instance_ip", return_value="192.0.2.1"), patch.object(
            manager.urllib.request, "urlopen", return_value=self.response(b'{"status":"ok"}')
        ) as open_url:
            self.assertEqual(manager.check_app_health(), (True, ""))
            self.assertEqual(open_url.call_args.args[0].full_url, "http://192.0.2.1/store-api/health")
            self.assertEqual(open_url.call_args.kwargs["timeout"], 5)

    def test_static_html_wrong_json_large_body_and_non_200_are_unhealthy(self):
        for body, status in [(b'<html>OK</html>', 200), (b'{"status":"down"}', 200),
                             (b'[]', 200), (b'x' * 4097, 200), (b'{"status":"ok"}', 503)]:
            with self.subTest(body=body[:30], status=status), patch.object(
                manager, "get_instance_ip", return_value="192.0.2.1"
            ), patch.object(manager.urllib.request, "urlopen", return_value=self.response(body, status)):
                self.assertFalse(manager.check_app_health()[0])

    def test_network_errors_and_missing_ip_do_not_claim_health(self):
        with patch.object(manager, "get_instance_ip", return_value=None):
            self.assertFalse(manager.check_app_health()[0])
        with patch.object(manager, "get_instance_ip", return_value="192.0.2.1"), patch.object(
            manager.urllib.request, "urlopen", side_effect=TimeoutError("test timeout")
        ):
            self.assertFalse(manager.check_app_health()[0])

    def test_monitor_mode_records_transition_without_restarting_or_rebooting(self):
        with patch.object(manager, "get_state", return_value={"resource_id": "app-health", "status": "HEALTHY"}), patch.object(
            manager, "update_state"
        ) as update, patch.object(manager, "log_audit_event") as audit, patch.object(
            manager, "send_sns"
        ) as notify, patch.object(manager, "ssm_client") as ssm, patch.object(manager, "ec2_client") as ec2:
            manager.process_resource("app-health", lambda: (False, "API unavailable"), None, "Store API health check")
            self.assertEqual(update.call_args.args[0]["status"], "UNHEALTHY")
            self.assertIn("checked_at", update.call_args.args[0])
            self.assertEqual(audit.call_args.args[0], "health")
            notify.assert_called_once()
            ssm.send_command.assert_not_called()
            ec2.reboot_instances.assert_not_called()

    def test_unchanged_monitor_state_does_not_repeat_alert_and_recovery_is_not_remediation(self):
        for previous, healthy, expected_alerts in [("UNHEALTHY", False, 0), ("UNHEALTHY", True, 1), ("HEALTHY", True, 0)]:
            with self.subTest(previous=previous, healthy=healthy), patch.object(
                manager, "get_state", return_value={"status": previous}
            ), patch.object(manager, "update_state"), patch.object(manager, "log_audit_event") as audit, patch.object(
                manager, "send_sns"
            ) as notify:
                manager.process_resource("app-health", lambda: (healthy, ""), None, "Store API health check")
                self.assertEqual(notify.call_count, expected_alerts)
                if expected_alerts:
                    self.assertEqual(audit.call_args.args[0], "health")

    def test_handler_uses_alert_only_for_ec2_and_separate_app_recovery(self):
        with patch.object(manager, "process_resource") as process, patch.object(manager, "process_store_api") as app:
            manager.handler({}, None)
            self.assertIsNone(process.call_args_list[0].kwargs["recovery_action_func"])
            self.assertEqual(process.call_count, 1)
            app.assert_called_once()


class StoreApiRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.record = {"resource_id": "app-health", "status": "HEALTHY", "attempts": 0}
        self.table = Mock()
        self.table.get_item.side_effect = lambda **kwargs: {"Item": copy.deepcopy(self.record)}
        self.table.put_item.side_effect = self.write
        self.ssm = Mock()
        self.ssm.send_command.return_value = {"Command": {"CommandId": "test-command"}}
        self.audit = Mock(return_value=True)
        self.notify = Mock()
        self.check = Mock(return_value=(False, "proxy health failed"))
        self.patch = patch.multiple(manager, state_table=self.table, ssm_client=self.ssm,
            log_audit_event=self.audit, send_sns=self.notify, check_app_health=self.check,
            check_ec2_health=Mock(return_value=(True, "")), APP_RECOVERY_ENABLED=True,
            STORE_API_RECOVERY_DOCUMENT="self-healing-start-store-api", INSTANCE_ID="i-test")
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def write(self, **kwargs):
        previous = self.record.get("recovery_version")
        expected = kwargs.get("ExpressionAttributeValues", {}).get(":v")
        if previous != expected:
            raise RuntimeError("conditional conflict")
        self.record = copy.deepcopy(kwargs["Item"])

    def pending(self, *, age=30, attempts=1):
        self.record.update(status="RECOVERING", attempts=attempts, recovery_version=2,
            recovery_phase="pending", ssm_command_id="test-command",
            command_started_at=(datetime.now(timezone.utc) - timedelta(seconds=age)).isoformat(),
            last_attempt_time=(datetime.now(timezone.utc) - timedelta(seconds=age)).isoformat())

    def test_healthy_and_disabled_modes_do_not_dispatch(self):
        self.check.return_value = (True, "")
        manager.process_store_api()
        self.assertEqual(self.record["status"], "HEALTHY")
        self.ssm.send_command.assert_not_called()
        self.check.return_value = (False, "proxy failed")
        with patch.object(manager, "APP_RECOVERY_ENABLED", False):
            manager.process_store_api()
        self.assertEqual(self.record["status"], "UNHEALTHY")
        self.ssm.send_command.assert_not_called()

    def test_dispatch_is_reserved_and_audited_before_a_fixed_guarded_command(self):
        manager.process_store_api()
        self.assertEqual(self.record["recovery_phase"], "pending")
        self.assertEqual(self.record["ssm_command_id"], "test-command")
        self.assertEqual(self.record["attempts"], 1)
        self.assertEqual(self.record["recovery_version"], 2)
        self.ssm.send_command.assert_called_once()
        self.assertEqual(self.audit.call_args.args[0], "recovery_requested")
        sent = self.ssm.send_command.call_args.kwargs
        self.assertEqual(sent["InstanceIds"], ["i-test"])
        self.assertEqual(sent["DocumentName"], "self-healing-start-store-api")
        self.assertNotIn("Parameters", sent)

    def test_state_read_write_conflict_and_audit_failures_prevent_dispatch(self):
        self.table.get_item.side_effect = RuntimeError("unavailable")
        manager.process_store_api()
        self.ssm.send_command.assert_not_called()
        self.table.get_item.side_effect = lambda **kwargs: {"Item": copy.deepcopy(self.record)}
        self.table.put_item.side_effect = RuntimeError("conflict")
        manager.process_store_api()
        self.ssm.send_command.assert_not_called()
        self.table.put_item.side_effect = self.write
        self.audit.return_value = False
        manager.process_store_api()
        self.ssm.send_command.assert_not_called()
        self.assertEqual(self.record["status"], "FAILED")

    def test_pending_and_eventually_consistent_results_never_dispatch_again(self):
        self.pending()
        self.ssm.get_command_invocation.return_value = {"Status": "InProgress"}
        manager.process_store_api()
        self.assertEqual(self.record["status"], "RECOVERING")
        self.ssm.get_command_invocation.side_effect = RuntimeError("not yet visible")
        manager.process_store_api()
        self.ssm.send_command.assert_not_called()
        self.assertEqual(self.record["ssm_command_id"], "test-command")

    def test_success_requires_completed_command_and_external_health(self):
        self.pending()
        self.check.return_value = (True, "")
        self.ssm.get_command_invocation.return_value = {"Status": "Success", "ResponseCode": 0,
                                                       "StandardOutputContent": "STORE_API_STARTED\n"}
        manager.process_store_api()
        self.assertEqual(self.record["status"], "HEALTHY")
        self.assertEqual(self.record["attempts"], 0)
        self.assertNotIn("ssm_command_id", self.record)
        self.assertEqual(self.audit.call_args.args[:2], ("remediation", "Start Store API verified"))
        self.assertTrue(self.audit.call_args.args[3])
        self.assertEqual(self.audit.call_args.kwargs["command_id"], "test-command")

    def test_completed_start_with_failed_proxy_is_not_reported_as_recovery(self):
        self.pending()
        self.ssm.get_command_invocation.return_value = {"Status": "Success", "ResponseCode": 0,
                                                       "StandardOutputContent": "STORE_API_STARTED"}
        manager.process_store_api()
        self.assertEqual(self.record["status"], "UNHEALTHY")
        self.assertFalse(self.audit.call_args.args[3])
        self.ssm.send_command.assert_not_called()

    def test_active_busy_and_disabled_markers_are_skips_not_verified_restarts(self):
        for marker in ["STORE_API_ACTIVE", "STORE_API_BUSY", "STORE_API_DISABLED"]:
            with self.subTest(marker=marker):
                self.pending()
                self.ssm.get_command_invocation.return_value = {"Status": "Success", "ResponseCode": 0,
                                                               "StandardOutputContent": marker}
                manager.process_store_api()
                self.assertEqual(self.record["status"], "UNHEALTHY")
                self.assertEqual(self.audit.call_args.args[0], "health")
                self.assertIn("skipped", self.audit.call_args.args[1])
                self.ssm.send_command.assert_not_called()

    def test_command_failure_retries_only_after_cooldown_and_stops_at_limit(self):
        self.pending(attempts=3)
        self.ssm.get_command_invocation.return_value = {"Status": "Failed", "ResponseCode": 1}
        manager.process_store_api()
        self.assertEqual(self.record["status"], "FAILED")
        manager.process_store_api()
        self.ssm.send_command.assert_not_called()

    def test_cooldown_and_failed_ec2_health_defer_new_commands(self):
        self.record.update(status="UNHEALTHY", attempts=1, last_attempt_time=datetime.now(timezone.utc).isoformat())
        manager.process_store_api()
        self.ssm.send_command.assert_not_called()
        self.record["last_attempt_time"] = "1970-01-01T00:00:00+00:00"
        with patch.object(manager, "check_ec2_health", return_value=(False, "unknown")):
            manager.process_store_api()
        self.ssm.send_command.assert_not_called()

    def test_uncertain_dispatch_and_expired_pending_command_block_replacements(self):
        self.ssm.send_command.side_effect = TimeoutError("unknown delivery")
        manager.process_store_api()
        self.assertEqual(self.record["status"], "FAILED")
        self.assertEqual(self.record["recovery_phase"], "dispatching")
        manager.process_store_api()
        self.assertEqual(self.ssm.send_command.call_count, 1)
        self.pending(age=200)
        self.ssm.get_command_invocation.return_value = {"Status": "InProgress"}
        manager.process_store_api()
        self.assertEqual(self.record["status"], "FAILED")
        self.assertIn("ssm_command_id", self.record)
        self.assertEqual(self.ssm.send_command.call_count, 1)

    def test_duplicate_invocation_loses_compare_and_set_and_cannot_dispatch(self):
        def concurrent_write(**kwargs):
            self.record["recovery_version"] = 1
            return self.write(**kwargs)
        self.table.put_item.side_effect = concurrent_write
        manager.process_store_api()
        self.ssm.send_command.assert_not_called()

    def test_running_checks_still_resolve_after_flag_is_disabled(self):
        self.pending()
        self.check.return_value = (True, "")
        self.ssm.get_command_invocation.return_value = {"Status": "Success", "ResponseCode": 0,
                                                       "StandardOutputContent": "STORE_API_ACTIVE"}
        with patch.object(manager, "APP_RECOVERY_ENABLED", False):
            manager.process_store_api()
        self.assertEqual(self.record["status"], "HEALTHY")
        self.ssm.send_command.assert_not_called()


class GuardedShellTests(unittest.TestCase):
    def test_real_shell_control_flow_with_stubbed_host_commands(self):
        bash = shutil.which("bash") or next((str(p) for p in [Path("C:/Program Files/Git/bin/bash.exe")] if p.exists()), None)
        if not bash:
            self.skipTest("Bash is unavailable; no host command was executed")
        mocks = {
            "flock": 'exit "${TEST_LOCK_RC:-0}"',
            "timeout": 'shift; exec "$@"',
            "sleep": 'exit 0',
            "curl": 'printf \'%s\' \'{"status":"ok"}\'',
            "node-mock": 'cat >/dev/null; exit "${TEST_NODE_RC:-0}"',
            "systemctl": '''case "$1" in
show) if [ "$4" = LoadState ]; then echo loaded; else echo "$TEST_ACTIVE"; fi ;;
is-enabled) [ "$TEST_ENABLED" = true ] ;;
is-active) exit 0 ;;
start|reset-failed) echo "$1" >> "$TEST_ACTIONS" ;;
*) exit 90 ;;
esac''',
        }
        test_root = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory(prefix="store-recovery-test-", dir=test_root) as directory:
            fixture = Path(directory)
            self.assertTrue(fixture.resolve().is_relative_to(test_root))
            for name, body in mocks.items():
                file = fixture / name
                file.write_text("#!/bin/sh\n" + body + "\n", newline="\n")
                file.chmod(0o755)
            document = json.loads((test_root.parent / "store_api_recovery_document.json").read_text())
            script = document["mainSteps"][0]["inputs"]["runCommand"][0].replace(
                "/run/fieldwork-store-api-recovery.lock", shlex.quote((fixture / "lock").as_posix())
            ).replace("/usr/bin/node-22", shlex.quote((fixture / "node-mock").as_posix()))
            script_path = fixture / "recovery.sh"
            script_path.write_text(script, newline="\n")
            for active, enabled, parser_rc, lock_rc, expected_actions, expected_marker, exit_code in [
                ("active", "true", "0", "0", [], "STORE_API_ACTIVE", 0),
                ("activating", "true", "0", "0", [], "STORE_API_BUSY", 0),
                ("inactive", "false", "0", "0", [], "STORE_API_DISABLED", 0),
                ("inactive", "true", "0", "1", [], "STORE_API_BUSY", 0),
                ("inactive", "true", "0", "0", ["start"], "STORE_API_STARTED", 0),
                ("failed", "true", "0", "0", ["reset-failed", "start"], "STORE_API_STARTED", 0),
                ("inactive", "true", "1", "0", ["start"], "", 11),
            ]:
                with self.subTest(active=active, enabled=enabled, parser_rc=parser_rc, lock_rc=lock_rc):
                    actions = fixture / "actions"
                    actions.write_text("")
                    env = {**os.environ, "TEST_BIN": fixture.as_posix(), "TEST_SCRIPT": script_path.as_posix(),
                           "TEST_ACTIVE": active, "TEST_ENABLED": enabled, "TEST_NODE_RC": parser_rc,
                           "TEST_LOCK_RC": lock_rc, "TEST_ACTIONS": actions.as_posix()}
                    result = subprocess.run([bash, "--noprofile", "--norc", "-c",
                        'if [ -x /usr/bin/cygpath ]; then TEST_BIN=$(/usr/bin/cygpath -u "$TEST_BIN"); fi; export PATH="$TEST_BIN:/usr/bin:/bin"; bash "$TEST_SCRIPT"'],
                        env=env, capture_output=True, text=True, timeout=20)
                    self.assertEqual(result.returncode, exit_code, result.stderr)
                    self.assertEqual(actions.read_text().splitlines(), expected_actions)
                    self.assertEqual(result.stdout.strip(), expected_marker)


if __name__ == "__main__":
    unittest.main()
