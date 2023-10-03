import PN532 from "..";
import express from 'express';
import { SerialPort } from "serialport";
const app = express();

const pn532 = new PN532('/dev/ttyAMA1', 2000, {
    encripted: false,
    showSteps: true,
    //baudRate: 115200,
    //authKey: [255, 255, 255, 255, 255, 255],
    //showDebug: false
});

pn532.on('data', console.log);

pn532.open();

app.listen(3030);