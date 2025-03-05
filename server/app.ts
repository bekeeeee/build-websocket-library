import http from "http";
import {CONSTANTS} from "./src/custom_library/websocket_constants";
import * as FUNCTIONS from "./src/custom_library/websocket_methods";
import {IncomingMessage as Request} from "http";

import internal from "stream";

const GET_INFO = 1;
const GET_LENGTH = 2;
const GET_MASK_KEY = 3;
const GET_PAYLOAD = 4;
const SEND_ECHO = 5;

// import the custom libraries

const HTTP_SERVER = http.createServer((req, res) => {
  res.writeHead(200, {"Content-Type": "text/plain"});
  res.end("Hello World\n");
});
HTTP_SERVER.listen(CONSTANTS.PORT, () => {
  console.log("Server is running on port " + CONSTANTS.PORT);
});

// ERROR HANDLING
CONSTANTS.CUSTOM_ERRORS.forEach(error => {
  process.on(error, err => {
    console.error(`Error: ${error} => ${err}`);

    // exit the server
    process.exit(1);
  });
});

HTTP_SERVER.on(
  "upgrade",
  (req: Request, socket: internal.Duplex, head: Buffer<ArrayBufferLike>) => {
    // grab the required request headers
    const upgradeHeaderCheck =
      req.headers["upgrade"]?.toLowerCase() === CONSTANTS.UPGRADE;
    const connectionHeaderCheck =
      req.headers["connection"]?.toLowerCase() === CONSTANTS.CONNECTION;
    const methodCheck = req.method === CONSTANTS.METHOD;

    // check the origin
    const origin = req.headers["origin"];
    const originCheck = FUNCTIONS.isOriginalAllowed(origin as string);

    // perform a final check that all request headers are okay, and only then do I want to handle the upgrade request from the server side
    if (
      FUNCTIONS.check(
        socket,
        upgradeHeaderCheck,
        connectionHeaderCheck,
        methodCheck,
        originCheck
      )
    ) {
      upgradeConnection(req, socket, head);
    }
  }
);

function upgradeConnection(
  req: Request,
  socket: internal.Duplex,
  head: Buffer<ArrayBufferLike>
) {
  // grab the client key
  const clientKey = req.headers["sec-websocket-key"];
  // generate response headers
  const headers = FUNCTIONS.createUpgradeHeaders(clientKey as string);
  socket.write(headers);
  // 🎉🙌 if successful, you now have a valid websocket connection
  startWebSocketConnection(socket);
}

function startWebSocketConnection(socket: internal.Duplex) {
  console.log("WebSocket connection established");
  const receiver = new WebSocketReceiver(socket);
  socket.on("data", chunk => {
    console.log("Received data");
    console.log("chunk: " + chunk.length);
    receiver.processBuffer(chunk);
  });
}

class WebSocketReceiver {
  private _socket: internal.Duplex;
  private _buffersArray: Buffer[] = [];
  private _bufferedBytesLength: number = 0;
  private _taskLoop = false;
  private _task = GET_INFO;
  private _fin = false; // indicates if the final fragment of a message is received
  private _opcode = 0; // indicates the type of payload
  private _masked = false; // indicates if the payload is masked
  private _initialPayloadSizeIndicator = 0; // indicates the size of the payload
  private _framePayloadLength = 0; // indicates the length of the payload
  private _maxPlayed = 1024 * 1024; // 1MB
  private _totalPayloadLength = 0; // indicates the total length of the payload
  private _mask = Buffer.alloc(CONSTANTS.MASK_LENGTH); // this will hold the masking key set and sent by the client
  private _framesReceived = 0; // tally of how many frames were received
  private _fragments: Buffer<ArrayBuffer>[] = []; // store fragments
  constructor(socket: internal.Duplex) {
    console.log("WebSocketReceiver constructor");
    this._socket = socket;
  }
  processBuffer(chunk: Buffer) {
    this._buffersArray.push(chunk);
    this._bufferedBytesLength += chunk.length;

    this.startTaskLoop();
  }
  private startTaskLoop() {
    this._taskLoop = true; // create a loop to complete numerous tasks, and also eventually to deal with fragmented data
    do {
      switch (this._task) {
        case GET_INFO:
          this._getInfo(); // first step is to get the information about the WS data received
          break;
        case GET_LENGTH:
          this._getLength(); // second step is to get the length of the payload
          break;
        case GET_MASK_KEY:
          this._getMaskKey(); // third step is to get the mask key
          break;
        case GET_PAYLOAD:
          this._getPayload(); // fourth step is to get the actual payload data
          break;
        case SEND_ECHO:
          this._sendEcho(); // fifth step is to send the echo back to the client
          break;
      }
    } while (this._taskLoop);
  }

  private _sendEcho() {}
  private _getPayload() {
    // *** LOOP for the full frame payload
    // if we have not yet received the payload, wait for another 'data' event fired on our socket object, in order to receive more payload
    if (this._bufferedBytesLength < this._framePayloadLength) {
      this._taskLoop = false;
      return;
    }
    // FULL FRAME RECEIVED (there may be more frames if we have a fragmented message)
    this._framesReceived++;

    // extract the actual payload data
    const payloadBuffer = this._consumePayload(this._framePayloadLength);
    // unmask the payload data
    const unmaskedPayload = FUNCTIONS.unmaskPayload(payloadBuffer, this._mask);
    console.log("unmasked payload: " + unmaskedPayload.toString("utf8"));
    // TEXT FRAME
    // push decode / unmasked data into our fragments array
    if (payloadBuffer.length) {
      this._fragments.push(unmaskedPayload);
    }
    // if this is the final fragment, then we can join all the fragments together
    if (this._fin) {
      console.log(
        "Total frames received in this WS message: " + this._framesReceived
      );
      console.log(
        "Total Payload size of the WS message is: " + this._totalPayloadLength
      );
      this._task = SEND_ECHO;
      // const message = Buffer.concat(this._fragments).toString();
      // console.log("Message: " + message);
      // this._fragments = [];
    } else {
      this._task = GET_INFO;
    }
    // send the unmasked payload data to the client
    // this._socket.write(unmaskedPayload);
    // this._task = SEND_ECHO;
  }
  private _consumePayload(bytesLength: number) {
    this._bufferedBytesLength -= bytesLength;

    const payloadBuffer = Buffer.alloc(bytesLength); // creating a new buffer for data we are yet to put into it.
    let totalBytesRead = 0;
    while (totalBytesRead < bytesLength) {
      const buf = this._buffersArray[0]; // retrieve the first chunk of data from an array of chunks
      const bytesToRead = Math.min(bytesLength - totalBytesRead, buf.length); // calculate the number of bytes to read from buf, ensuring that it does not access the reaming bytes needed to reach bytesLength
      buf.copy(payloadBuffer, totalBytesRead, 0, bytesToRead); // copy the bytes from buf to payloadBuffer
      totalBytesRead += bytesToRead; // increment the totalBytesRead by the number of bytes read from buf
      if (bytesToRead < buf.length) {
        this._buffersArray[0] = buf.slice(bytesToRead);
      } else {
        this._buffersArray.shift(); // remove the entire first element in the array
      }
    }
    return payloadBuffer;
  }
  private _getMaskKey() {
    this._mask = this._consumeHeaders(CONSTANTS.MASK_LENGTH);
    this._task = GET_PAYLOAD;
  }
  private _getLength() {
    // extract the actual payload length of the WS message
    switch (this._initialPayloadSizeIndicator) {
      case CONSTANTS.MEDIUM_DATA_FLAG:
        let mediumPayloadLengthBuffer = this._consumeHeaders(
          CONSTANTS.MEDIUM_SIZE_CONSUMPTION
        );
        this._framePayloadLength = mediumPayloadLengthBuffer.readUInt16BE();
        this._processLength();
        break;
      case CONSTANTS.LARGE_DATA_FLAG:
        let largePayloadLengthBuffer = this._consumeHeaders(
          CONSTANTS.LARGE_SIZE_CONSUMPTION
        );
        let bufBigInt = largePayloadLengthBuffer.readBigUInt64BE();
        this._framePayloadLength = Number(bufBigInt);
        this._processLength();
        break;
      default:
        // if the payload is <= 125 bytes, then we know that the WS initialPayloadSizeIndicator (7 bits) represents the actual payload length of the frame.
        this._framePayloadLength = this._initialPayloadSizeIndicator;
        this._processLength();
        break;
    }

    // this._task = GET_MASK_KEY;
  }
  private _processLength() {
    this._totalPayloadLength += this._framePayloadLength;
    // throw error if user attempts to abuse the WS server
    if (this._totalPayloadLength > this._maxPlayed) {
      // later send a close frame back to the client and terminate the connection
      throw Error("Payload is too large");
    }
    // unmask the payload data

    if (this._masked) {
      this._task = GET_MASK_KEY;
    } else {
      throw Error("Received data is not masked");
    }
  }

  private _getInfo() {
    const infoBuffer = this._consumeHeaders(CONSTANTS.MIN_FRAME_SIZE);
    const firstByte = infoBuffer[0];
    const secondByte = infoBuffer[1];
    // extract WS payload information
    this._fin = (firstByte & 0x80) === 0x80;
    this._opcode = firstByte & 0x0f;
    this._masked = (secondByte & 0x80) === 0x80;
    this._initialPayloadSizeIndicator = secondByte & 0x7f;
    // if data is not masked, then throw an error
    if (!this._masked) {
      throw Error("Received data is not masked");
    }
    this._task = GET_LENGTH;
  }
  private _consumeHeaders(bytesLength: number): Buffer<ArrayBufferLike> {
    // reduce our buffered bytes length by how many bytes we will consume
    this._bufferedBytesLength -= bytesLength;

    if (bytesLength === this._buffersArray[0].length) {
      return this._buffersArray.shift() as Buffer<ArrayBufferLike>;
    }
    if (bytesLength < this._buffersArray[0].length) {
      let buffer = this._buffersArray[0];
      let result = buffer.slice(0, bytesLength);
      this._buffersArray[0] = buffer.slice(bytesLength);
      return result;
    } else {
      throw Error(
        "You cannot extract more data from a ws frame than the actual frame size."
      );
    }
  }
}
