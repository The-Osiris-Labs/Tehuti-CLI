import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

export const SOCKET_PATH = path.join(os.homedir(), '.tehuti', 'tehutid.sock');

export class TehutiDaemonClient {
  private client: net.Socket | null = null;

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = net.createConnection(SOCKET_PATH);

      this.client.on('connect', () => {
        resolve();
      });

      this.client.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  public send(data: string | Buffer): void {
    if (this.client) {
      this.client.write(data);
    } else {
      throw new Error('Not connected');
    }
  }

  public disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }

  public onData(callback: (data: Buffer) => void): void {
    if (this.client) {
      this.client.on('data', callback);
    }
  }
}
