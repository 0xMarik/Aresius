export interface WsStream {
    id: number;
    projectId: string;
    destination: string;
    path: string;
    isTls: boolean;
    createdAt: number;
    closedAt?: number | null;
    status: 'open' | 'closed' | 'error';
    messageCount: number;
}

export type WsDirection = 'ClientToServer' | 'ServerToClient';
export type WsMessageType = 'Text' | 'Binary' | 'Ping' | 'Pong' | 'Close';

export interface WsMessage {
    id: number;
    streamId: number;
    projectId: string;
    direction: WsDirection;
    messageType: WsMessageType;
    payload: string;
    payloadLength: number;
    sentAt: number;
}

export interface WsStreamClosedEvent {
    streamId: number;
    closedAt: number;
    status: string;
}
