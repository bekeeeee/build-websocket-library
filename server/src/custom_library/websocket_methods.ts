import {CONSTANTS} from "./websocket_constants";
import internal from "stream";
import * as crypto from "crypto";
import {server} from "typescript";

export function isOriginalAllowed(origin: string): boolean {
  return CONSTANTS.ALLOWED_ORIGINS.includes(origin);
}
export function check(
  socket: internal.Duplex,
  upgradeHeaderCheck: boolean,
  connectionHeaderCheck: boolean,
  methodCheck: boolean,
  originCheck: boolean
) {
  if (
    upgradeHeaderCheck &&
    connectionHeaderCheck &&
    methodCheck &&
    originCheck
  ) {
    return true;
  }
  const message =
    "400 bad request. The HTTP headers do not comply with the RFC6455 spec."; // custom server message sent back with HTTP response
  const messageLength = message.length;
  const response =
    `HTTP/1.1 400 Bad Request\r\n` + // remember each header has to be end with a \r\n to comply with HTTP protocol rules
    `Content-Type: text/plain\r\n` +
    `Content-Length: ${messageLength}\r\n` +
    `\r\n` +
    message;
  socket.write(response); // access our socket object, and send back a HTTP response
  socket.end(); // this will close the TCP connection and keep the server running
}
export function createUpgradeHeaders(clientKey: string) {
  // generate the server key

  let serverKey = generateServerKey(clientKey);
  let headers = [
    `HTTP/1.1 101 Switching Protocols`,
    `Upgrade: websocket`,
    `Connection: Upgrade`,
    `Sec-WebSocket-Accept: ${serverKey}`,
  ];
  return headers.join("\r\n") + "\r\n\r\n";
}

function generateServerKey(clientKey: string): string {
  // concat / join the client key with the GUID
  let data = clientKey + CONSTANTS.GUID;
  let hash = crypto.createHash("sha1");
  hash.update(data);
  return hash.digest("base64");
}
