import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { OnGatewayConnection } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import cookie from 'cookie';

const { verify } = jwt;
const { parse } = cookie;

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      if (
        !origin ||
        origin === process.env.CORS_ORIGIN ||
        /^http:\/\/localhost(?::\d+)?$/.test(origin)
      )
        callback(null, true);
      else callback(new Error('Origin not allowed'));
    },
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  handleConnection(client: Socket): void {
    try {
      const cookies = parse(client.handshake.headers.cookie ?? '');
      const claims = verify(
        cookies.bellmont_session ?? '',
        process.env.JWT_SECRET ?? 'development-only-secret',
      );
      client.data.user = claims;
    } catch {
      client.disconnect(true);
    }
  }
  publish(event: string, payload: unknown): void {
    this.server?.emit(event, payload);
  }
}
