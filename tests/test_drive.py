#!/usr/bin/env python3
# coding: utf-8
from __future__ import print_function, unicode_literals

import os
import shutil
import tempfile
import unittest

from copyparty.authsrv import AuthSrv
from copyparty.httpcli import HttpCli
from tests import util as tu
from tests.util import J2_ENV, Cfg


def hdr(query, uname, ua="", cookie=""):
    xh = ""
    if uname != "*":
        xh += "PW: %s\r\n" % (uname,)
    if ua:
        xh += "User-Agent: %s\r\n" % (ua,)
    if cookie:
        xh += "Cookie: %s\r\n" % (cookie,)
    h = "GET /%s HTTP/1.1\r\n%sConnection: close\r\n\r\n"
    return (h % (query, xh)).encode("utf-8")


class TestDrive(unittest.TestCase):
    def setUp(self):
        self.conn = None
        self.td = tu.get_ramdisk()
        os.chdir(self.td)
        os.mkdir("pub")
        os.mkdir("pub/sub")
        os.mkdir("priv")
        with open("pub/a.txt", "wb") as f:
            f.write(b"hello\n")

    def tearDown(self):
        if self.conn:
            self.conn.shutdown()
        os.chdir(tempfile.gettempdir())
        shutil.rmtree(self.td)

    def cinit(self, **ka):
        vcfg = ["pub:pub:r:rw,u1", "priv:priv:rw,u1"]
        self.args = Cfg(v=vcfg, a=["u1:u1"], **ka)
        self.asrv = AuthSrv(self.args, self.log)
        if self.conn:
            self.conn.shutdown()
        self.conn = tu.VHttpConn(self.args, self.asrv, self.log, b"")
        self.conn.hsrv.j2["drive"] = J2_ENV.from_string("DRIVE-UI {{ uname }}")
        self.conn.hsrv.j2["browser"] = J2_ENV.from_string("CLASSIC-UI")

    def curl(self, url, uname, ua="", cookie=""):
        conn = self.conn.setbuf(hdr(url, uname, ua, cookie))
        HttpCli(conn).run()
        h, b = conn.s._reply.decode("utf-8").split("\r\n\r\n", 1)
        return h, b

    def status(self, h):
        return int(h.split("\r\n")[0].split(" ")[1])

    def cookies(self, h):
        ret = {}
        for ln in h.split("\r\n"):
            if ln.lower().startswith("set-cookie:"):
                k, v = ln.split(":", 1)[1].strip().split(";")[0].split("=", 1)
                ret[k] = v
        return ret

    def test_no_drive(self):
        # --no-drive: classic everywhere, ?drive / ?legacy do nothing special
        self.cinit(no_drive=True)
        for vp in ("", "pub/", "pub/?drive", "pub/?legacy", "pub/?legacy=0"):
            h, b = self.curl(vp, "u1")
            self.assertEqual(self.status(h), 200, vp)
            self.assertNotIn("DRIVE-UI", b, vp)
            if vp:
                # (the root is the control-panel, as there is no root volume)
                self.assertEqual(b, "CLASSIC-UI", vp)
            self.assertNotIn("cpp_legacy", self.cookies(h), vp)

    def test_default(self):
        self.cinit(no_drive=False)
        for vp, un in [
            ("", "u1"),
            ("pub/", "u1"),
            ("pub/sub/", "u1"),
            ("pub/", "*"),
            # the app shell is served even where the user has no access,
            # so it can offer a login; all data still goes through ?ls
            ("priv/", "*"),
            ("", "*"),
        ]:
            h, b = self.curl(vp, un)
            self.assertEqual(self.status(h), 200, vp)
            self.assertEqual(b, "DRIVE-UI " + un, vp)

        # and ?ls still enforces permissions as usual
        h, b = self.curl("priv/?ls", "*")
        self.assertNotEqual(self.status(h), 200)

        # files are still files
        h, b = self.curl("pub/a.txt", "*")
        self.assertEqual(b, "hello\n")

        # inaccessible file-ish paths are not turned into an app shell
        h, b = self.curl("priv/nope.txt", "*")
        self.assertNotEqual(self.status(h), 200)
        self.assertNotIn("DRIVE-UI", b)

        # non-browser views are unchanged
        h, b = self.curl("pub/?ls", "u1")
        self.assertIn('"files"', b)
        self.assertIn("a.txt", b)
        for vp in ("pub/?b", "pub/?h", "pub/?dots"):
            h, b = self.curl(vp, "u1")
            self.assertNotIn("DRIVE-UI", b, vp)

        # curl gets the plaintext listing, like before
        h, b = self.curl("pub/", "u1", ua="curl/8.5.0")
        self.assertNotIn("DRIVE-UI", b)
        self.assertNotIn("CLASSIC-UI", b)
        self.assertIn("a.txt", b)

    def test_legacy(self):
        self.cinit(no_drive=False)

        # ?legacy serves classic and sets the sticky cookie
        h, b = self.curl("pub/?legacy", "u1")
        self.assertEqual(b, "CLASSIC-UI")
        self.assertEqual(self.cookies(h).get("cpp_legacy"), "1")
        self.assertIn("Expires=", h)

        # the cookie sticks
        h, b = self.curl("pub/", "u1", cookie="cpp_legacy=1")
        self.assertEqual(b, "CLASSIC-UI")
        h, b = self.curl("priv/", "*", cookie="cpp_legacy=1")
        self.assertNotIn("DRIVE-UI", b)

        # ?legacy=0 clears it and lands on the plain path (the drive-ui)
        h, b = self.curl("pub/sub/?legacy=0", "u1", cookie="cpp_legacy=1")
        self.assertEqual(self.status(h), 302)
        self.assertIn("\r\nLocation: /pub/sub/", h)
        self.assertEqual(self.cookies(h).get("cpp_legacy"), "x")
        self.assertIn("Expires=Fri, 15 Aug 1997", h)

    def test_old_links(self):
        self.cinit(no_drive=False)

        # ?drive links redirect to the plain path
        for vp, dst in [
            ("?drive", "/"),
            ("pub/?drive", "/pub/"),
            ("pub/sub/?drive", "/pub/sub/"),
        ]:
            h, b = self.curl(vp, "u1")
            self.assertEqual(self.status(h), 302, vp)
            self.assertIn("\r\nLocation: %s\r\n" % (dst,), h, vp)

        # also when drive is opted out of; ?drive opts back in
        h, b = self.curl("pub/?drive", "u1", cookie="cpp_legacy=1")
        self.assertEqual(self.status(h), 302)
        self.assertEqual(self.cookies(h).get("cpp_legacy"), "x")

    def log(self, src, msg, c=0):
        print(msg, "\033[0m")


if __name__ == "__main__":
    unittest.main()
