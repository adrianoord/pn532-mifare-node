import { SerialPort } from "serialport";
import ECOMMANDS from "./models/commands.enum";
import { EventEmitter } from "stream";
import Frame from "./frame.class";

enum EBaudRates {
    BR9600 = 9600,
    BR19200 = 19200,
    BR38400 = 38400,
    BR57600 = 57600,
    BR115200 = 115200,
    BR230400 = 230400
}

const BytesBaudRate = {
    9600: 0x00,
    19200: 0x01,
    38400: 0x02,
    57600: 0x03,
    115200: 0x04,
    230400: 0x05
}

export default class PN532 extends EventEmitter {
    private _frame: Frame;

    private _direction: number = 0xd4;
    private isOpen: boolean = false;
    private port: SerialPort;
    private logger: {
        step: Function,
        infoCard: Function,
        bufferIn: Function,
        bufferOut: Function,
        error: Function
    } = {
            step: (c) => { },
            bufferIn: (c) => { },
            bufferOut: (c) => { },
            infoCard: (c) => { },
            error: (c) => { }
        };

    constructor(private path: string, private pollInterval: number, private options?: {
        encripted: boolean,
        tagNumber?: number | Buffer,
        blockAddress?: number | Buffer,
        authType?: number | Buffer,
        authKey?: number[] | Buffer,
        showSteps?: boolean,
        showBufferIn?: boolean,
        showBufferOut?: boolean,
        showInfoCard?: boolean,
        baudRate?: number
    }) {
        super();
        const _options = this.options;

        if (_options.showSteps) {
            this.logger.step = (log) => {
                console.log('Step:', log);
            }
        }
        if (_options.showBufferIn) {
            this.logger.bufferIn = (log) => {
                console.log('BufferIn:', log);
            }
        }
        if (_options.showBufferOut) {
            this.logger.bufferOut = (log) => {
                console.log('BufferOut:', log);
            }
        }
        if (_options.showInfoCard) {
            this.logger.infoCard = (log) => {
                console.log('InfoCard:', log);
            }
        }

        this.on('newListener', (event) => {
            if (event === 'data') {
                var scanTag = () => {
                    if (this.isOpen && this.port && this.port.isOpen) {
                        this.readCard()
                            .then(async (tag) => {
                                if (tag) {
                                    if (this.isOpen) this.emit('data', tag);
                                    await this.sleep(this.pollInterval);
                                    scanTag();
                                } else {
                                    scanTag();
                                }
                            })
                            .catch(async () => {
                                this.sleep(100).then(scanTag);
                            });
                    } else {
                        this.sleep(100).then(scanTag);
                    }
                };
                scanTag();
            }
        });
    }

    private async getTag() {
        this.logger.step("Waiting tag...");
        const data = [
            ECOMMANDS.PN532_COMMAND_INLISTPASSIVETARGET,
            0x01,
            ECOMMANDS.PN532_MIFARE_ISO14443A
        ];
        const buffer = await this._frame.runCommand(data, this._direction);
        const uid = buffer.slice(1).slice(12, 12 + buffer[10]).toString("hex").match(/.{1,2}/g).join(":");
        const lengthUid = buffer[10];
        const uidDec = buffer.slice(1).slice(12, 12 + buffer[10]).join('');
        if (uid.split(":").length != lengthUid) throw "Uid incompativel com o tamanho esperado";
        return {
            uid,
            lengthUid: buffer[10],
            uidDec,
            ATQA: buffer.slice(9, 11),
            SAK: buffer[11]
        }
    }

    private async readBlock() {
        this.logger.step("Read block...");
        const _options = this.options;

        const tagNumber = _options.tagNumber || 0x01;
        const blockAddress = _options.blockAddress || 0x01;

        const data = [
            ECOMMANDS.PN532_COMMAND_INDATAEXCHANGE,
            tagNumber,
            ECOMMANDS.MIFARE_CMD_READ,
            blockAddress,
        ];
        const buffer = await this._frame.runCommand(data, this._direction);
        console.log(buffer);
        const dataCard = buffer.slice(8, 8 + 6);
        const dataNumbers = Array.prototype.slice.call(dataCard);
        const dataFormated = dataNumbers.map((i) => {
            if (i < 10) return "0" + i;
            return "" + i;
        }).join("");
        return dataFormated;
    }

    private authenticateBlock(uidArray: any, lgUid: number) {
        this.logger.step("Authenticate block...");
        const options = this.options;

        const blockAddress = options.blockAddress || 0x01;
        const authType = options.authType || ECOMMANDS.MIFARE_CMD_AUTH_A;
        const authKey = options.authKey || [255, 255, 255, 255, 255, 255];
        const tagNumber = options.tagNumber || 0x01;
        uidArray = uidArray.split(':').map(s => Number('0x' + s));

        const data = [
            ECOMMANDS.PN532_COMMAND_INDATAEXCHANGE,
            tagNumber,
            authType,
            blockAddress
        ].concat(authKey).concat(uidArray);

        try {
            if (uidArray.length != lgUid) throw 'Tamanho do UID incompativel';
            return this._frame.runCommand(data, this._direction);
        } catch (_e) {
            this.logger.error(_e);
            throw _e;
        }
    }

    private async setBaudRate(baudRate: EBaudRates, timeout: number) {
        return new Promise<boolean>(async (resolve) => {
            const timeoutInit = setTimeout(() => resolve(false), timeout);
            this.logger.step("Setting Baud Rate... " + baudRate);
            const data = [
                ECOMMANDS.PN532_COMMAND_SETSERIALBAUDRATE
            ];
            switch (baudRate) {
                case EBaudRates.BR9600:
                    data.push(BytesBaudRate[EBaudRates.BR9600]);
                    break;
                case EBaudRates.BR19200:
                    data.push(BytesBaudRate[EBaudRates.BR19200]);
                    break;
                case EBaudRates.BR38400:
                    data.push(BytesBaudRate[EBaudRates.BR38400]);
                    break;
                case EBaudRates.BR57600:
                    data.push(BytesBaudRate[EBaudRates.BR57600]);
                    break;
                case EBaudRates.BR115200:
                    data.push(BytesBaudRate[EBaudRates.BR115200]);
                    break;
                case EBaudRates.BR230400:
                    data.push(BytesBaudRate[EBaudRates.BR230400]);
                    break;
            }
            const response = await this._frame.runCommand(data, this._direction);
            clearTimeout(timeoutInit);
            await this.sendACK();
            await this.sleep(500);
            this.port.close();
            await this.sleep(500);
            await this.openSerialPort(this.path, baudRate);
            this._frame = new Frame(this.port, this.logger);
            resolve(true);
        });
    }

    private async sendACK() {
        const data = [0, 0, 255, 0, 255, 0];
        this.port.write(data);
    }

    private async powerDown() {
        try {
            this.logger.step("Setting Power Down...");
            const data = [
                ECOMMANDS.PN532_COMMAND_POWERDOWN,
                0x55
            ];
            this.logger.step("BaudRate: " + this.port.baudRate);
            await this._frame.runCommand(data, this._direction);
            await this.sleep(this.pollInterval);
            this._frame.setWakeUp(false);
            return;
        } catch (_e) {
            console.error(_e);
        }
    }

    private async setSAM(tout: number) {
        return new Promise(async (resolve, reject) => {
            try {
                const timeoutInit = setTimeout(() => resolve(false), tout);
                this.logger.step("Setting SAM config...");
                const timeout = 0x00;
                const data = [
                    ECOMMANDS.PN532_COMMAND_SAMCONFIGURATION,
                    ECOMMANDS.SAMCONFIGURATION_MODE_NORMAL,
                    timeout,
                    0x01 // Use IRQ pin
                ];
                await this._frame.runCommand(data, this._direction);
                clearTimeout(timeoutInit);
                resolve(true);
            } catch (_e) {
                reject(_e);
            }
        });
    }

    private async getFirmware(timeout: number) {
        return new Promise(async (resolve, reject) => {
            try {
                const timeoutInit = setTimeout(() => resolve(false), timeout);
                this.logger.step("Get Firmware...");
                const data = [0x02];
                await this._frame.runCommand(data, this._direction);
                clearTimeout(timeoutInit);
                resolve(true);
            } catch (_e) {
                reject(_e);
            }
        });
    }

    private async readCard() {
        try {
            const options = this.options;
            const infoCard = await this.getTag();
            this.logger.infoCard(infoCard);
            if (options.encripted) {
                await this.authenticateBlock(infoCard.uid, infoCard.lengthUid);
                const dataBlock = await this.readBlock();
                return dataBlock;
            }
            return infoCard.uidDec;
        } catch (e) {
            if (e == 'timeout') throw e;
            await this.sleep(20);
        }
    }

    public async open() {
        try {
            const _options = this.options;
            await this.openSerialPort(this.path, _options.baudRate || 115200);
            this._frame = new Frame(this.port, this.logger);
            if (!this.isOpen && this.port && this.port.isOpen) {
                await (new Promise<void>(async (resolve) => {
                    const timeoutInit = setTimeout(() => this.open(), 5000);
                    if (!_options.baudRate) {
                        await this.findBaudRate();
                        await this.setBaudRate(EBaudRates.BR230400, 1000);
                    }
                    this.port.close();
                    await this.sleep(500);
                    await this.openSerialPort(this.path, EBaudRates.BR230400);
                    this._frame = new Frame(this.port, this.logger);
                    await this.powerDown();
                    clearTimeout(timeoutInit);
                    this.emit('open');
                    this.isOpen = true;
                }));
            } else {
                setTimeout(() => this.open(), 100);
            }
        } catch (_e) {
            setTimeout(() => this.open(), 100);
        }
    }

    private findBaudRate() {
        return new Promise(async (resolve) => {
            this.logger.step("FINDING BAUDRATE...");
            for (const key in BytesBaudRate) {
                if (!!(await this.setSAM(500) && await this.getFirmware(500))) {
                    this.port.close();
                    await this.sleep(500);
                    await this.openSerialPort(this.path, parseInt(key));
                    this._frame = new Frame(this.port, this.logger);
                } else {
                    this.logger.step("FINDED BAUDRATE: " + this.port.baudRate);
                    await this.sleep(500);
                    break;
                }
            }
            resolve(true);
        });
    }

    private openSerialPort(path: string, baudRate: number) {
        return new Promise<void>((r, _) => {
            this.port = new SerialPort({ path, baudRate, autoOpen: true });
            this.port.on('close', () => {
                // try {
                //     this._frame.close();
                // } catch(e){}
                // _();
                r();
            });
            this.port.on('error', () => {
                // try {
                //     this._frame.close();
                // } catch(e){}
                // _();
                r();
            });
            this.port.on('open', () => {
                r();
            });
        });
    }

    async stop() {
        this.isOpen = false;
    }

    async start() {
        this.isOpen = true;
    }

    async close() {
        this.isOpen = false;
        this.port.isOpen ? this.port.close() : "";
    }

    private async sleep(ms: number) {
        return new Promise(r => setTimeout(r, ms))
    }
}