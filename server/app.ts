import http from "http";
import {CONSTANTS} from "./src/custom_library/websocket_constants";
import * as FUNCTIONS from "./src/custom_library/websocket_methods";
import {IncomingMessage as Request} from "http";

import internal from "stream";
let clientNumber = 0;
const GET_INFO = 1;
const GET_LENGTH = 2;
const GET_MASK_KEY = 3;
const GET_PAYLOAD = 4;
const SEND_ECHO = 5;
const GET_CLOSE_INFO = 6;

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
  console.log(
    "WebSocket connection established WITH CLIENT PORT: ",
    (socket as any).remotePort
  );
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
    clientNumber++;
    console.log("clientNumber: " + clientNumber);
  }
  processBuffer(chunk: Buffer) {
    this._buffersArray.push(chunk);
    this._bufferedBytesLength += chunk?.length;
    console.log("Chunk received of size: " + chunk.length);

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
        case GET_CLOSE_INFO:
          this._getCloseInfo(); // sixth step is to get the close frame information
          break;
      }
    } while (this._taskLoop);
  }
  private _sendClose(closeCode: number, closeReason: string) {
    // extract and/or construct the closure code & reason
    let closureCode =
      typeof closeCode !== "undefined" && closeCode ? closeCode : 1000;
    console.log("closureCode =: " + closureCode);
    let closureReason =
      typeof closeReason !== "undefined" && closeReason ? closeReason : "";

    // get the length of the binary representation our reason
    const closureReasonBuffer = Buffer.from(closureReason, "utf8");
    const closureReasonLength = closureReasonBuffer.length;
    // construct the close frame payload (mandatory 2 bytes closure code, + payload)
    const closeFramePayload = Buffer.alloc(2 + closureReasonLength);
    // write the close code into the payload
    closeFramePayload.writeUInt16BE(closureCode, 0);
    closureReasonBuffer.copy(closeFramePayload, 2);

    // final step: create the first byte and second byte, and then create the final frame to send back to the client
    const firstByte = 0x88; // 10001000
    const secondByte = closeFramePayload.length;
    const mandatoryCloseHeaders = Buffer.from([firstByte, secondByte]);
    // now create the final close frame
    const closeFrame = Buffer.concat([
      mandatoryCloseHeaders,
      closeFramePayload,
    ]);
    // send the close frame to the client
    this._socket.write(closeFrame);
    this._socket.end();
    // reset the values
    this._reset();
  }

  private _getCloseInfo() {
    // control frames cannot be fragmented. so we know that one fragment exists in our array that contains our entire closure body data
    let closeFramePayload = this._fragments[0];
    if (!closeFramePayload) {
      this._sendClose(1008, "Next time, pls set the status code.");
      return;
    }
    let closeCode = closeFramePayload.readUint16BE();
    let closeReason = closeFramePayload.toString("utf8", 2);
    if (closeCode === 1001) {
      this._socket.end();
      this._reset();
      return;
    }
    console.log(
      `Received close frame with code: ${closeCode} and reason: ${closeReason}`
    );
    let serverResponse = "Sorry to see you go. Please open up a new connection";
    this._sendClose(closeCode, serverResponse);
  }
  private _getInfo() {
    // check whether we have eno ugh bytes in our internal buffer to process at the very least frame header information
    if (this._bufferedBytesLength < CONSTANTS.MIN_FRAME_SIZE) {
      // wait for additional chunks via the 'data' event on our socket object
      this._taskLoop = false;
      return;
    }
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
      // this._sendClose()
      throw Error("Received data is not masked");
    }
    // **** PING AND PONG FRAMES
    if ([CONSTANTS.OPCODE_PING, CONSTANTS.OPCODE_PONG].includes(this._opcode)) {
      // send a close frame and close the underlying WS connection
      this._sendClose(1003, "the server does not support ping or pong frames.");
    }
    this._task = GET_LENGTH;
  }
  private _consumeHeaders(bytesLength: number): Buffer<ArrayBufferLike> {
    // reduce our buffered bytes length by how many bytes we will consume
    this._bufferedBytesLength -= bytesLength;

    if (bytesLength === this._buffersArray[0]?.length) {
      return this._buffersArray.shift() as Buffer<ArrayBufferLike>;
    }

    if (bytesLength < this._buffersArray[0]?.length) {
      // create a temporary info buffer from the _buffersArray
      let infoBuffer = this._buffersArray[0];
      // remove consumed bytes from our buffer
      this._buffersArray[0] = this._buffersArray[0].slice(bytesLength);
      return infoBuffer.slice(0, bytesLength);
    } else {
      throw Error(
        "You cannot extract more data from a ws frame than the actual frame size."
      );
    }
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
    // Close the websocket connection if user attempts to abuse our WS server
    if (this._totalPayloadLength > this._maxPlayed) {
      this._sendClose(
        1009,
        "The WS server doesn't support such huge message length"
      );
      throw Error("Payload is too large");
    }
    // unmask the payload data

    if (this._masked) {
      this._task = GET_MASK_KEY;
    } else {
      throw Error("Received data is not masked");
    }
  }
  private _getMaskKey() {
    this._mask = this._consumeHeaders(CONSTANTS.MASK_LENGTH);
    this._task = GET_PAYLOAD;
  }
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
    // console.log("unmasked payload: " + unmaskedPayload.toString("utf8"));
    // push decode / unmasked data into our fragments array
    if (payloadBuffer?.length) {
      this._fragments.push(unmaskedPayload);
    }

    // **** CLOSE FRAME
    if (this._opcode === CONSTANTS.OPCODE_CLOSE) {
      this._task = GET_CLOSE_INFO;
      return;
    }
    if (this._framePayloadLength <= 0) {
      this._sendClose(1008, "The text area can't be empty.");
      return;
    }

    // TEXT FRAME
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
  private _sendEcho() {
    // **** TASK 1: CONSTRUCT AN EMPTY FRAME WITH CORRECT SIZE ****
    // extract our entire message (could consist of numerous frame) from our persistent _fragments array, and create ONE buffer with the entire message.
    const fullMessage = Buffer.concat(this._fragments); // this is the actual payload of our WS frame
    let payloadLength = fullMessage.length;
    let additionalPayloadSizeIndicator = null;
    // determine the additional bytes required to represent the payload size
    switch (true) {
      case payloadLength <= CONSTANTS.SMALL_DATA_SIZE:
        additionalPayloadSizeIndicator = 0;
        break;
      case payloadLength > CONSTANTS.SMALL_DATA_SIZE &&
        payloadLength <= CONSTANTS.MEDIUM_DATA_SIZE:
        additionalPayloadSizeIndicator = CONSTANTS.MEDIUM_SIZE_CONSUMPTION;
        break;
      default:
        additionalPayloadSizeIndicator = CONSTANTS.LARGE_SIZE_CONSUMPTION;
        break;
    }
    const frame = Buffer.alloc(
      CONSTANTS.MIN_FRAME_SIZE + additionalPayloadSizeIndicator + payloadLength
    );
    // populate the frame with all header info
    // first byte
    let fin = 0x01;
    let rev1 = 0x00;
    let rev2 = 0x00;
    let rev3 = 0x00;
    let opcode = CONSTANTS.OPCODE_BINARY;
    let firstByte =
      (fin << 7) | (rev1 << 6) | (rev2 << 5) | (rev3 << 4) | opcode;
    frame[0] = firstByte;
    // second byte
    let mask = 0x00;
    // let secondByte = 0x00;
    if (payloadLength <= CONSTANTS.SMALL_DATA_SIZE) {
      frame[1] = mask | payloadLength;
    } else if (
      payloadLength > CONSTANTS.SMALL_DATA_SIZE &&
      payloadLength <= CONSTANTS.MEDIUM_DATA_SIZE
    ) {
      frame[1] = mask | CONSTANTS.MEDIUM_DATA_FLAG;
      frame.writeUInt16BE(payloadLength, CONSTANTS.MIN_FRAME_SIZE);
    } else {
      frame[1] = mask | CONSTANTS.LARGE_DATA_FLAG;
      frame.writeBigUInt64BE(BigInt(payloadLength), CONSTANTS.MIN_FRAME_SIZE);
    }

    // add payload to the frame
    const messageStartOffset =
      CONSTANTS.MIN_FRAME_SIZE + additionalPayloadSizeIndicator;
    fullMessage.copy(frame, messageStartOffset);
    // send the frame to the client and reset the values
    this._socket.write(frame);
    this._reset();
  }

  private _reset() {
    this._buffersArray = [];
    this._bufferedBytesLength = 0;

    this._taskLoop = false;
    this._task = GET_INFO;
    this._fin = false;

    this._opcode = 0;
    this._masked = false;
    this._initialPayloadSizeIndicator = 0;

    this._framePayloadLength = 0;
    this._totalPayloadLength = 0; // indicates the total length of the payload
    this._mask = Buffer.alloc(CONSTANTS.MASK_LENGTH); // this will hold the masking key set and sent by the client

    this._framesReceived = 0; // tally of how many frames were received
    this._fragments = [];
  }
}
