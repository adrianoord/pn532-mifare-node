import { SerialPort } from "serialport";
import ECOMMANDS from "./models/commands.enum";
import { EventEmitter } from "stream";
import Frame from "./frame.class";

export default class PN532 extends EventEmitter {

    private _direction: number = 0xd4;
    private isOpen: boolean = false;
    private isWakeup: boolean = false;

    constructor(private port: SerialPort, private pollInterval: number, private options?: any) {
        super();
        if (this.options && !this.options.showDebug) {
            console.debug = (c) => {}
        }
        this.on('newListener', (event) => {
            if (event === 'data') {
                var scanTag = () => {
                    if (this.isOpen) {
                        this.readCard().then(async (tag) => {
                            if (tag) {
                                if (this.isOpen) this.emit('data', tag);
                                this.sleep(this.pollInterval).then(scanTag);
                            } else {
                                await this.powerDown();
                                this.sleep(100).then(scanTag);
                            }

                        });
                    } else {
                        this.sleep(100).then(scanTag);
                    }
                };
                scanTag();
            }
        });
    }

    public getFirmware() {
        console.log("Get Firmware...");
        const data = [0x02];
        const frame = new Frame(this.port, data, this._direction);
        return frame.runCommand(this.isWakeup, (res) => this.isWakeup = res);
    }

    public async getTag() {
        console.log("Waiting tag...");
        const data = [
            ECOMMANDS.PN532_COMMAND_INLISTPASSIVETARGET,
            0x01,
            0x00
        ];
        const frame = new Frame(this.port, data, this._direction);
        const buffer = await frame.runCommand(this.isWakeup, (res) => this.isWakeup = res);
        const uid = buffer.slice(1).slice(12, 12 + buffer[10]).toString("hex").match(/.{1,2}/g).join(":");
        const uidDec = buffer.slice(1).slice(12, 12 + buffer[10]).join('');
        return {
            uid,
            lengthUid: buffer[10],
            uidDec,
            ATQA: buffer.slice(9, 11),
            SAK: buffer[11]
        }
    }

    async readBlock() {
        console.debug("Read block...");
        var options = this.options || {};

        const tagNumber = options.tagNumber || 0x01;
        const blockAddress = options.blockAddress || 0x01;

        const data = [
            ECOMMANDS.PN532_COMMAND_INDATAEXCHANGE,
            tagNumber,
            ECOMMANDS.MIFARE_CMD_READ,
            blockAddress,
        ];
        const frame = new Frame(this.port, data, this._direction);
        const buffer = await frame.runCommand(this.isWakeup);
        const dataCard = buffer.slice(8, 8 + 6);
        return dataCard.map((i) => i).join("");
    }

    authenticateBlock(uidArray: any, lgUid: number) {
        console.debug("Authenticate block...");
        var options = this.options || {};

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
            console.debug(uidArray);
            if(uidArray.length != lgUid) throw 'Tamanho do UID incompativel';
            const frame = new Frame(this.port, data, this._direction);
            return frame.runCommand(this.isWakeup, (res) => this.isWakeup = res);
        } catch(_e){
            console.debug(_e);
            throw _e;
        }
    }

    public async powerDown() {
        try {
            console.debug("Setting Power Down...");
            const data = [
                ECOMMANDS.PN532_COMMAND_POWERDOWN,
                0x55
            ];

            const frame = new Frame(this.port, data, this._direction);
            console.debug(await frame.runCommand(this.isWakeup, (res) => this.isWakeup = res));
            await this.sleep(1000);
            this.isWakeup = false;
            await this.setSAM();
            return;
        } catch(_e) {
            console.error(_e);
        }
    }

    public setSAM() {
        try {
            console.log("Setting SAM config...");
            const timeout = 0x00;
            const data = [
                ECOMMANDS.PN532_COMMAND_SAMCONFIGURATION,
                ECOMMANDS.SAMCONFIGURATION_MODE_NORMAL,
                timeout,
                0x01 // Use IRQ pin
            ];

            const frame = new Frame(this.port, data, this._direction);
            return frame.runCommand(this.isWakeup, (res) => this.isWakeup = res);
        } catch (_e) {
            console.error(_e);
        }
    }

    async readCard() {
        try {
            const options = this.options || {};
            const infoCard = await this.getTag();
            console.debug(infoCard);
            if (options.encripted) {
                await this.authenticateBlock(infoCard.uid, infoCard.lengthUid);
                const dataBlock = await this.readBlock();
                return dataBlock;
            }
            return infoCard.uidDec;
        } catch (e) {
            await (new Promise(r => setTimeout(r, 100)));
        }
    }

    async open() {
        await this.powerDown();
        //await this.setSAM();
        //await this.getFirmware();
        this.isOpen = true;
    }

    async stop() {
        this.isOpen = false;
    }

    async start() {
        this.isOpen = true;
    }

    async sleep(ms: number) {
        return new Promise(r=>setTimeout(r, ms))
    }
}