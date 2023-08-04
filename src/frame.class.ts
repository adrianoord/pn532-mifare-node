import { SerialPort } from "serialport";
import ECOMMANDS from "./models/commands.enum";
import { EventEmitter } from "stream";

export enum EFrameType {
    ERRORFRAME = "ERRORFRAME",
    ACKFRAME = "ACKFRAME",
    DATAFRAME = "DATAFRAME",
    NACKFRAME = "NACKFRAME"
}

export default class Frame {
    public frameEmitter: EventEmitter = new EventEmitter();

    constructor(private port: SerialPort, private _data, private _direction, private options?: {waitAck: boolean}) {
        this.port.on('data', (frame) => {
            console.debug(frame);
            this.frameEmitter.emit('frame', frame);
        });
    }

    public runCommand(isWakeup:boolean, callback?:Function) {
        return new Promise<Buffer>(async (resolve, reject) => {
            const options = this.options || ({} as any);
            try {
                var removeListeners = () => {
                    this.frameEmitter.removeListener('frame', onFrame);
                    this.port.removeAllListeners('data');
                };

                // Wire up listening to wait for response (or error) from PN532
                var onFrame = (frame) => {
                    const typeFrame = this.fromBuffer(frame);
                    console.debug(typeFrame);
                    switch(typeFrame) {
                        case EFrameType.ACKFRAME:
                            break;
                        case EFrameType.ERRORFRAME:
                            removeListeners();
                            reject(frame);
                            break;
                        case EFrameType.NACKFRAME:
                            break;
                        case EFrameType.DATAFRAME:
                            removeListeners();
                            resolve(frame);
                            break;
                    }
                };
                this.frameEmitter.on('frame', onFrame);

                // Send command to PN532
                var buffer = this.toBuffer();
                if (!isWakeup) {
                    const wakeUp = Buffer.from([0x55, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                    buffer = Buffer.concat([wakeUp, this.toBuffer()]);
                    callback(true);
                }
                //console.debug('Enviando ---->:');
                //console.debug(buffer.toString('hex').match(/.{1,2}/g).join(", "));
                this.port.write(buffer);
            } catch (_e) {
                console.error(_e);
                reject(_e);
            }
        });
    }

    public toBuffer() {
        var array = [].concat([
            ECOMMANDS.PREAMBLE,
            ECOMMANDS.START_CODE_1,
            ECOMMANDS.START_CODE_2,
            this.getDataLength(),
            this.getDataLengthChecksum(),
            this._direction,
        ], this._data, [
            this.getDataChecksum(),
            ECOMMANDS.POSTAMBLE
        ]);
        return Buffer.from(array);
    }

    public fromBuffer(buffer): EFrameType {
        if (this.isErrorFrame(buffer)) return EFrameType.ERRORFRAME;
        if (this.isAckFrame(buffer)) return EFrameType.ACKFRAME;
        if (this.isNackFrame(buffer)) return EFrameType.NACKFRAME;
        return EFrameType.DATAFRAME;
    }

    private getDataLength() {
        return this._data.length + 1;
    }

    private getDataLengthChecksum() {
        return (~this.getDataLength() & 0xFF) + 0x01;
    }

    private getDataChecksum() {
        var dataCopy = this._data.slice();
        dataCopy.push(this._direction);

        var sum = dataCopy.reduce((prev, current) => prev + current);
        var inverse = (~sum & 0xFF) + 0x01;

        if (inverse > 255) {
            inverse = inverse - 255;
        }

        return inverse;
    }

    private isAckFrame(buffer) {
        // Checks if the buffer is an ACK frame. [00 00 FF 00 FF 00]
        return (buffer.length <= 6 &&
            buffer[0] === ECOMMANDS.PREAMBLE &&
            buffer[1] === ECOMMANDS.START_CODE_1 &&
            buffer[2] === ECOMMANDS.START_CODE_2 &&
            buffer[3] === 0x00 &&
            buffer[4] === 0xFF &&
            buffer[5] === ECOMMANDS.POSTAMBLE);
    }

    public isErrorFrame(buffer) {
        // Checks if the buffer is an ACK frame. [00 00 ff 01 ff 7f 81 00]
        return (buffer.length >= 8 &&
            ((buffer[0] === ECOMMANDS.PREAMBLE &&
            buffer[1] === ECOMMANDS.START_CODE_1 &&
            buffer[2] === ECOMMANDS.START_CODE_2 &&
            buffer[3] === 0x01 &&
            buffer[4] === 0xFF &&
            buffer[5] === 0x7F &&
            buffer[6] === 0x81 &&
            buffer[7] === ECOMMANDS.POSTAMBLE) ||
            (buffer[6]==0x41 && buffer[7])));
    }

    public isNackFrame(buffer) {
        // Checks if the buffer is an NACK frame. [00 00 FF FF 00 00]
        return (buffer.length >= 6 &&
            buffer[0] === ECOMMANDS.PREAMBLE &&
            buffer[1] === ECOMMANDS.START_CODE_1 &&
            buffer[2] === ECOMMANDS.START_CODE_2 &&
            buffer[3] === 0xFF &&
            buffer[4] === 0x00 &&
            buffer[5] === ECOMMANDS.POSTAMBLE);
    }

    async sleep(ms: number) {
        return new Promise(r=>setTimeout(r, ms))
    }
}