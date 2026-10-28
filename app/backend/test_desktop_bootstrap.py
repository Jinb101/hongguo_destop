import ctypes
from pathlib import Path, PureWindowsPath
import selectors
import socket
import struct
import subprocess
import sys
import unittest
from unittest import mock

import desktop_bootstrap as bootstrap


class PosixListenerTests(unittest.TestCase):
    pid = 4321

    def setUp(self):
        for patcher in (
            mock.patch.object(bootstrap.os, "name", "posix"),
            mock.patch.object(bootstrap.sys, "platform", "darwin"),
            mock.patch.object(bootstrap, "_signer_probe", None),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch.object(bootstrap.subprocess, "run")
        self.run = patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def record(endpoint="127.0.0.1:43210", family="IPv4", fd=3):
        return f"f{fd}\nt{family}\nn{endpoint}\n"

    def inspect(self, stdout, code=0, stderr=""):
        self.run.return_value = subprocess.CompletedProcess([], code, stdout, stderr)
        return bootstrap.owned_listener_port(self.pid)

    def test_unique_loopback_and_machine_format_command(self):
        for port in (1, 43210, 65535):
            with self.subTest(port=port):
                self.assertEqual(self.inspect(f"p{self.pid}\n" + self.record(f"127.0.0.1:{port}")), port)
                self.assertEqual(bootstrap._signer_probe, "listener_found")
        self.run.assert_called_with(
            ["/usr/sbin/lsof", "-nP", "-a", "-p", str(self.pid), "-iTCP", "-sTCP:LISTEN", "-Fptn"],
            capture_output=True, text=True, timeout=10, check=False,
        )

    def test_no_matches(self):
        self.assertIsNone(self.inspect("", code=1))
        self.assertEqual(bootstrap._signer_probe, "no_owned_rows")

    def test_multiple_listeners_including_duplicate_ports(self):
        for endpoint in ("127.0.0.1:43210", "127.0.0.1:43211"):
            with self.subTest(endpoint=endpoint), self.assertRaises(RuntimeError):
                self.inspect(f"p{self.pid}\n" + self.record() + self.record(endpoint, fd=4))
            self.assertEqual(bootstrap._signer_probe, "ambiguous_listener")

    def test_non_loopback_listeners(self):
        for host in ("*", "0.0.0.0", "127.0.0.2", "192.0.2.1", "localhost"):
            with self.subTest(host=host), self.assertRaises(RuntimeError):
                self.inspect(f"p{self.pid}\n" + self.record(f"{host}:43210"))
            self.assertEqual(bootstrap._signer_probe, "unexpected_listener")

    def test_ipv6_listeners(self):
        for endpoint in ("[::1]:43210", "*:43210", "[::ffff:127.0.0.1]:43210", "127.0.0.1:43210"):
            with self.subTest(endpoint=endpoint), self.assertRaises(RuntimeError):
                self.inspect(f"p{self.pid}\n" + self.record(endpoint, family="IPv6"))
            self.assertEqual(bootstrap._signer_probe, "unexpected_listener")

    def test_extra_unsafe_listener_is_not_ignored(self):
        for unsafe in (self.record("*:43211", fd=4), self.record("[::1]:43211", "IPv6", fd=4)):
            for records in (self.record() + unsafe, unsafe + self.record()):
                with self.subTest(records=records), self.assertRaises(RuntimeError):
                    self.inspect(f"p{self.pid}\n" + records)
                self.assertEqual(bootstrap._signer_probe, "unexpected_listener")

    def test_invalid_endpoints(self):
        for port in ("0", "65536", "999999", "-1", "abc", "", "01", "１２３", "123 (LISTEN)", "123->127.0.0.1:456"):
            with self.subTest(port=port), self.assertRaises(RuntimeError):
                self.inspect(f"p{self.pid}\n" + self.record(f"127.0.0.1:{port}"))
            self.assertEqual(bootstrap._signer_probe, "unexpected_listener")

    def test_wrong_pid_and_malformed_output(self):
        valid = f"p{self.pid}\n" + self.record()
        malformed = (
            "", "\n", f"p{self.pid}\n", "p9999\n" + self.record(),
            valid + "p9999\n" + self.record(), valid + valid,
            f"p{self.pid}\ntIPv4\nn127.0.0.1:43210\n",
            valid.replace("tIPv4\n", ""), valid.replace("n127.0.0.1:43210\n", ""),
            valid.replace("tIPv4", "tREG"), valid.replace("f3", "funknown"),
            valid.replace("tIPv4\n", "tIPv4\ntIPv4\n"),
            valid.replace("f3\n", "f3\ncjava\n"), valid[:-1],
            "lsof: permission denied\n", "warning\n" + valid, valid + "warning\n",
            "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\njava 4321 user 3u IPv4 0 0 TCP 127.0.0.1:43210 (LISTEN)\n",
        )
        for stdout in malformed:
            with self.subTest(stdout=stdout), self.assertRaises(RuntimeError):
                self.inspect(stdout)
            self.assertEqual(bootstrap._signer_probe, "invalid_table")

    def test_command_errors_never_mean_not_started(self):
        valid = f"p{self.pid}\n" + self.record()
        for code, stdout, stderr in (
            (0, valid, "lsof: warning\n"), (0, "", "error"), (0, valid, "\n"),
            (1, "", "permission denied"), (1, valid, ""), (1, "error\n", ""),
            (1, "\n", ""), (2, "", ""), (2, valid, ""), (-9, "", ""),
        ):
            with self.subTest(code=code, stdout=stdout, stderr=stderr), self.assertRaises(OSError):
                self.inspect(stdout, code, stderr)
            self.assertEqual(bootstrap._signer_probe, "query_failed")

    def test_command_exceptions(self):
        for error in (FileNotFoundError(), PermissionError(), subprocess.TimeoutExpired("lsof", 10)):
            with self.subTest(error=type(error).__name__), self.assertRaises(OSError):
                self.run.side_effect = error
                bootstrap.owned_listener_port(self.pid)
            self.assertEqual(bootstrap._signer_probe, "query_failed")

    def test_invalid_pid_does_not_run_lsof(self):
        for pid in (0, -1, "4321", True, None):
            with self.subTest(pid=pid), self.assertRaises(RuntimeError):
                bootstrap.owned_listener_port(pid)
        self.run.assert_not_called()


class WindowsListenerTests(unittest.TestCase):
    @staticmethod
    def table(rows):
        raw = struct.pack("=I", len(rows)) + bytes(bootstrap.TcpTable.rows.offset - 4)
        for pid, address, port, state in rows:
            row = bootstrap.TcpRow()
            row.pid, row.state = pid, state
            row.address = struct.unpack("=I", socket.inet_aton(address))[0]
            row.port = socket.htons(port)
            raw += bytes(row)
        return raw

    def test_injected_query_on_macos_preserves_windows_invariants(self):
        cases = (
            ([(4321, "127.0.0.1", 43210, 2), (9999, "0.0.0.0", 43211, 2)], 43210, "listener_found"),
            ([], None, "no_owned_rows"),
            ([(4321, "127.0.0.1", 43210, 0)], None, "non_listening_rows"),
            ([(4321, "127.0.0.1", 43210, 5)], None, "non_listening_rows"),
            ([(4321, "0.0.0.0", 43210, 2)], RuntimeError, "unexpected_listener"),
            ([(4321, "127.0.0.1", 0, 2)], RuntimeError, "unexpected_listener"),
            ([(4321, "127.0.0.1", 43210, 2)] * 2, RuntimeError, "ambiguous_listener"),
        )
        with mock.patch.object(bootstrap.os, "name", "posix"), \
                mock.patch.object(bootstrap.sys, "platform", "darwin"), \
                mock.patch.object(bootstrap, "posix_owned_listener_port") as posix, \
                mock.patch.object(bootstrap, "_signer_probe", None):
            for rows, expected, probe in cases:
                raw = self.table(rows)

                def query(buffer, size, ordered, family, table_class, reserved):
                    self.assertEqual((ordered, family, table_class, reserved), (False, socket.AF_INET, 5, 0))
                    ctypes.cast(size, ctypes.POINTER(ctypes.c_uint32)).contents.value = len(raw)
                    if buffer is None:
                        return 122
                    ctypes.memmove(buffer, raw, len(raw))
                    return 0

                injected = mock.Mock(side_effect=query)
                with self.subTest(rows=rows):
                    if expected is RuntimeError:
                        with self.assertRaises(RuntimeError):
                            bootstrap.owned_listener_port(4321, query=injected)
                    else:
                        self.assertEqual(bootstrap.owned_listener_port(4321, query=injected), expected)
                    self.assertEqual(injected.call_count, 2)
                    self.assertEqual(bootstrap._signer_probe, probe)
            posix.assert_not_called()

    def test_default_windows_query_uses_system_dll(self):
        query = mock.Mock(return_value=5)
        library = mock.Mock(GetExtendedTcpTable=query)
        with mock.patch.object(bootstrap.os, "name", "nt"), \
                mock.patch.object(bootstrap.ctypes, "WinDLL", return_value=library, create=True) as load, \
                mock.patch.object(bootstrap, "posix_owned_listener_port") as posix, \
                mock.patch.object(bootstrap, "_signer_probe", None):
            with self.assertRaises(OSError):
                bootstrap.owned_listener_port(4321)
            load.assert_called_once_with("iphlpapi.dll", winmode=0x00000800)
            posix.assert_not_called()
            self.assertEqual(bootstrap._signer_probe, "query_failed")


class JavaLauncherTests(unittest.TestCase):
    def test_windows_returns_original_bundle_path_without_fallback(self):
        root = PureWindowsPath("C:/bundle")
        with mock.patch.object(bootstrap.os, "name", "nt"), \
                mock.patch.object(bootstrap.shutil, "which") as which, \
                mock.patch.object(bootstrap.os, "access") as access, \
                mock.patch.object(bootstrap.Path, "is_file") as is_file:
            self.assertEqual(bootstrap.java_launcher(root), str(root / "jre/bin/java.exe"))
            which.assert_not_called()
            access.assert_not_called()
            is_file.assert_not_called()

    def test_macos_paths_and_precedence(self):
        root = Path("/bundle")
        bundled = root / "jre/Contents/Home/bin/java"
        flat = root / "jre/bin/java"
        home = Path("/java-home/bin/java")
        path_java = "/opt/homebrew/bin/java"
        cases = (
            ("bundle priority", {bundled, flat, home}, {bundled, flat, home}, "/java-home", bundled),
            ("flat bundle", {flat, home}, {flat, home}, "/java-home", flat),
            ("java home", {home}, {home}, "/java-home", home),
            ("bundle not executable", {bundled, flat}, {flat}, "", flat),
            ("bundle is directory", set(), {bundled}, "", path_java),
            ("home missing", set(), set(), "/java-home", path_java),
            ("home not executable", {home}, set(), "/java-home", path_java),
            ("relative home", {Path("relative/bin/java")}, {Path("relative/bin/java")}, "relative", path_java),
            ("path fallback", set(), set(), "", path_java),
        )
        for name, files, executable, java_home, expected in cases:
            with self.subTest(name=name), \
                    mock.patch.object(bootstrap.os, "name", "posix"), \
                    mock.patch.object(bootstrap.sys, "platform", "darwin"), \
                    mock.patch.dict(bootstrap.os.environ, {"JAVA_HOME": java_home}), \
                    mock.patch.object(bootstrap.Path, "is_file", autospec=True, side_effect=lambda path: path in files), \
                    mock.patch.object(bootstrap.os, "access", side_effect=lambda path, mode: mode == bootstrap.os.X_OK and path in executable), \
                    mock.patch.object(bootstrap.shutil, "which", return_value=path_java) as which:
                self.assertEqual(bootstrap.java_launcher(root), str(expected))
                if expected == path_java:
                    which.assert_called_once_with("java")
                else:
                    which.assert_not_called()

    def test_missing_runtime(self):
        root = Path("/bundle")
        with mock.patch.object(bootstrap.os, "name", "posix"), \
                mock.patch.object(bootstrap.sys, "platform", "darwin"), \
                mock.patch.dict(bootstrap.os.environ, {"JAVA_HOME": ""}), \
                mock.patch.object(bootstrap.Path, "is_file", return_value=False), \
                mock.patch.object(bootstrap.shutil, "which", return_value=None):
            with self.assertRaises(FileNotFoundError):
                bootstrap.java_launcher(root)


@unittest.skipUnless(sys.platform == "darwin", "Requires macOS lsof")
class RealListenerTests(unittest.TestCase):
    def test_temporary_child_listener_discovery_and_exit(self):
        self.assertTrue(Path("/usr/sbin/lsof").is_file())
        code = (
            "import select, socket, sys\n"
            "with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:\n"
            "    listener.bind(('127.0.0.1', 0))\n"
            "    listener.listen(1)\n"
            "    print(listener.getsockname()[1], flush=True)\n"
            "    select.select([sys.stdin], [], [], 15)\n"
        )
        with mock.patch.object(bootstrap, "_signer_probe", None), \
                mock.patch.object(bootstrap, "_signer_exit_code", None), \
                subprocess.Popen(
                    [sys.executable, "-I", "-B", "-u", "-c", code],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                ) as child:
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(child.stdout, selectors.EVENT_READ)
                    self.assertTrue(selector.select(timeout=5), "Listener child did not become ready")
                port = int(child.stdout.readline())
                self.assertGreater(port, 0)
                self.assertEqual(bootstrap.owned_listener_port(child.pid), port)
                self.assertEqual(bootstrap.wait_signer(child, timeout=2), port)
                _, stderr = child.communicate(input="\n", timeout=5)
                self.assertEqual((child.returncode, stderr), (0, ""))
                self.assertIsNone(bootstrap.owned_listener_port(child.pid))
                self.assertEqual(bootstrap._signer_probe, "no_owned_rows")
                with self.assertRaisesRegex(RuntimeError, "Signing service exited"):
                    bootstrap.wait_signer(child, timeout=2)
                self.assertEqual(bootstrap._signer_probe, "process_exited")
                self.assertEqual(bootstrap._signer_exit_code, 0)
            finally:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
