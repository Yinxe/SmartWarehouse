/**
 * 玩家通知端口。
 *
 * 定义向附近玩家或指定玩家发送消息的接口。
 */

export interface NotifierPort {
  sendInfo(nearby: { displayName: string; dimensionId: string }, message: string): void;
  sendWarn(nearby: { displayName: string; dimensionId: string }, message: string): void;
  sendMessage(playerId: string, message: string): void;
}
