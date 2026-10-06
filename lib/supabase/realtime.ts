/**
 * 服务端 Supabase 客户端的 realtime 配置。
 *
 * 为什么要单独拎出这个文件：
 * @supabase/supabase-js 创建客户端时会**立刻**为 realtime 频道找一个 WebSocket 实现
 * （realtime-js 的 WebSocketFactory.getWebSocketConstructor），
 * 运行环境里没有全局 WebSocket 就直接 throw。
 * 而 Node 22 才内置全局 WebSocket——部署平台的函数运行时若是 Node 20（实测 EdgeOne Makers 就是），
 * 一创建客户端就抛错，中间件挂掉，整站 500：
 * `{"error":"Middleware execution failed","message":"Node.js detected but native WebSocket not found..."}`
 *
 * 官方给的绕法是把 transport 显式传进去（realtime-js 会优先用传入的 transport），
 * 也就是这个文件在做的事。
 *
 * 只用于服务端：浏览器本来就有 WebSocket，lib/supabase/client.ts 不需要它。
 */

/**
 * 占位实现。本项目从不订阅 realtime 频道，所以它永远不会被实例化；
 * 它的作用只是让 realtime 客户端能顺利构造出来。
 */
class UnusedWebSocketTransport {
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }
}

/**
 * 传给 createServerClient 的 realtime 选项。
 * 有原生 WebSocket 就用原生的（Node 22+ / 部分运行时），没有就用占位实现。
 */
export function realtimeOptions() {
  const nativeWebSocket: typeof globalThis.WebSocket | undefined = globalThis.WebSocket;

  return {
    realtime: {
      transport: nativeWebSocket ?? UnusedWebSocketTransport,
    },
  };
}
