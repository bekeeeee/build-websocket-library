import http from "http";
import {CONSTANTS} from "./src/custom_library/websocket_constants";

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
