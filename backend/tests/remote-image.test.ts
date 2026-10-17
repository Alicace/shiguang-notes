import assert from "node:assert/strict";
import test from "node:test";
import {
  downloadRemoteImage,
  isPrivateNetworkAddress,
} from "../../server/security/remote-image.js";

test("远端图片下载拒绝回环、私网、链路本地和保留地址", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "64:ff9b::7f00:1",
    "2002:7f00:0001::",
    "2001:db8::1",
  ]) {
    assert.equal(isPrivateNetworkAddress(address), true, address);
  }
  assert.equal(isPrivateNetworkAddress("8.8.8.8"), false);
  assert.equal(isPrivateNetworkAddress("2606:4700:4700::1111"), false);
});

test("远端图片请求在建立连接前拒绝 localhost 与内网地址", async () => {
  await assert.rejects(
    downloadRemoteImage("http://localhost/photo.png", 1024),
    /私有或保留网络/,
  );
  await assert.rejects(
    downloadRemoteImage("http://10.0.0.1/photo.png", 1024),
    /私有或保留网络/,
  );
  await assert.rejects(
    downloadRemoteImage("http://[::ffff:7f00:1]/photo.png", 1024),
    /私有或保留网络/,
  );
});
