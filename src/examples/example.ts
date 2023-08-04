import PN532 from "..";
import express from 'express';
import { SerialPort } from "serialport";
const app = express();

const serialPort = new SerialPort({
    path: 'COM6',
    baudRate: 115200
});
const pn532 = new PN532(serialPort, 2000, {
    encripted: false,
    //authKey: [255, 255, 255, 255, 255, 255],
    //showDebug: false
});

pn532.on('data', console.log);

pn532.open();

app.listen(3030);