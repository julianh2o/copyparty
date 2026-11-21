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


def hdr(query, uname):
    pw = "" if uname == "*" else "PW: %s\r\n" % (uname,)
    h = "GET /%s HTTP/1.1\r\n%sConnection: close\r\n\r\n"
    return (h % (query, pw)).encode("utf-8")


class TestDrive(unittest.TestCase):
    def setUp(self):
        self.conn = None
        self.td = tu.get_ramdisk()
        os.chdir(self.td)
        os.mkdir("pub")
        os.mkdir("priv")

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

    def curl(self, url, uname):
        conn = self.conn.setbuf(hdr(url, uname))
        HttpCli(conn).run()
        return conn.s._reply.decode("utf-8").split("\r\n\r\n", 1)

    def test_drive(self):
        # disabled by default; ?drive falls through to the regular ui
        self.cinit()
        h, b = self.curl("pub/?drive", "u1")
        self.assertNotIn("DRIVE-UI", b)

        self.cinit(drive=True)
        for vp, un in [
            ("?drive", "u1"),
            ("pub/?drive", "u1"),
            ("pub/?drive", "*"),
            # the app shell is served even where the user has no access,
            # so it can offer a login; all data still goes through ?ls
            ("priv/?drive", "*"),
        ]:
            h, b = self.curl(vp, un)
            self.assertIn(" 200 OK", h.split("\r\n")[0], vp)
            self.assertEqual(b, "DRIVE-UI " + un, vp)

        # and ?ls still enforces permissions as usual
        h, b = self.curl("priv/?ls", "*")
        self.assertNotIn(" 200 OK", h.split("\r\n")[0])

    def log(self, src, msg, c=0):
        print(msg, "\033[0m")


if __name__ == "__main__":
    unittest.main()
