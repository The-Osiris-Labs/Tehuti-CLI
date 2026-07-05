import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

export const SOCKET_PATH = path.join(os.homedir(), '.tehuti', 'tehutid.sock');

export class TehutiDaemonServer extends EventEmitter {
  private server: net.Server;

  constructor() {
    super();
    this.server = net.createServer((socket: net.Socket) => {
      this.emit('connection', socket);

      socket.on('data', (data: Buffer) => {
        this.emit('data', socket, data);
      });

      socket.on('error', (err: Error) => {
        this.emit('clientError', err);
      });

      socket.on('end', () => {
        this.emit('clientDisconnect');
      });
    });

    this.server.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }

  public start(): void {
    const socketDir = path.dirname(SOCKET_PATH);
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    }

    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }

    this.server.listen(SOCKET_PATH, () => {
      fs.chmodSync(SOCKET_PATH, 0o600);
      this.emit('listening', SOCKET_PATH);
    });
  }

  public stop(): void {
    this.server.close(() => {
      if (fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
      }
      this.emit('close');
    });
  }
}
