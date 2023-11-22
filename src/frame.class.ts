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
    private isWakeup: boolean = false;
    private _data: (number | Buffer)[];
    private _direction: number;
    private timeoutToFinish;

    constructor(private port: SerialPort, private logger: {
        step: Function,
        infoCard: Function,
        bufferIn: Function,
        bufferOut: Function
    }) {
        this.port.on('data', (frame) => {
            const dataSplited = this.getSplitedFrame(frame);
            for (const data of dataSplited) {
                this.frameEmitter.emit('frame', data);
            }
        });
    }

    public close() {
        this.port.removeAllListeners('data');
        this.frameEmitter.removeAllListeners();
    }

    public setWakeUp(isWakeUp: boolean) {
        this.isWakeup = isWakeUp;
    }

    public runCommand(data: (number | Buffer)[], direction: number) {
        this._data = data;
        this._direction = direction;
        return new Promise<Buffer>(async (resolve, reject) => {
            try {
                var removeListeners = () => {
                    clearTimeout(this.timeoutToFinish);
                    this.frameEmitter.removeAllListeners();
                };

                // Wire up listening to wait for response (or error) from PN532
                var onFrame = (frame) => {
                    this.logger.bufferIn(frame);
                    const typeFrame = this.fromBuffer(frame);
                    this.isWakeup = true;
                    switch(typeFrame) {
                        case EFrameType.ACKFRAME:
                        case EFrameType.NACKFRAME:
                            break;
                        case EFrameType.ERRORFRAME:
                            removeListeners();
                            reject(frame);
                            break;
                        case EFrameType.DATAFRAME:
                            removeListeners();
                            resolve(frame);
                            break;
                    }
                };

                removeListeners();
                this.frameEmitter.on('frame', onFrame);

                // Send command to PN532
                var buffer = this.toBuffer();
                if (!this.isWakeup) {
                    const wakeUp = Buffer.from([0x55, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                    buffer = Buffer.concat([wakeUp, this.toBuffer()]);
                }
                this.logger.bufferOut(buffer);
                console.log(this.port.isOpen);
                this.port.write(buffer);

                this.timeoutToFinish = setTimeout(() => {
                    removeListeners();
                    reject("timeout");
                }, 60*1000);
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
        var dataCopy = this._data.slice() as number[];
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


    public getSplitedFrame(data: Buffer) {
        const frames = [
            Buffer.from([0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00]),
            Buffer.from([0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00]),
            Buffer.from([0x00, 0x00, 0xff, 0x01, 0xff, 0x7f, 0x81, 0x00])
        ];
        const frameSplited = [];

        for (let frame of frames) {
            const idxFrame = data.indexOf(frame);
            if (idxFrame != -1) {
                const frameToPush = data.slice(idxFrame, idxFrame + frame.length);
                data = data.slice(idxFrame + frame.length);
                frameSplited.push(frameToPush);
            }
        }
        if (data.length > 0) frameSplited.push(data);
        return frameSplited;
    }

    async sleep(ms: number) {
        return new Promise(r=>setTimeout(r, ms))
    }
}