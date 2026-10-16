import { randomUUID } from 'node:crypto';
import type { Principal } from '@gc/contracts';
import { WorkOrderError } from '../application/ports.js';

/** Demonstration sessions are created only by the explicit demonstration composition. */
export class DemoSessions {
  private readonly sessions = new Map<
    string,
    { identityId: string; expires: number }
  >();
  constructor(
    readonly identities: readonly Principal[],
    private readonly now: () => number,
  ) {}
  actor(cookie: string | undefined) {
    const session = cookie ? this.sessions.get(cookie) : undefined;
    if (!session || session.expires <= this.now()) {
      if (cookie) this.sessions.delete(cookie);
      return null;
    }
    return (
      this.identities.find((identity) => identity.id === session.identityId) ??
      null
    );
  }
  login(identityId: string, old: string | undefined) {
    const identity = this.identities.find((item) => item.id === identityId);
    if (!identity) throw new WorkOrderError('FORBIDDEN', '演示身份不存在');
    for (const [id, session] of this.sessions)
      if (session.expires <= this.now()) this.sessions.delete(id);
    if (old) this.sessions.delete(old);
    if (this.sessions.size >= 100)
      throw new WorkOrderError('FORBIDDEN', '演示会话已满，请稍后重试');
    const token = randomUUID();
    this.sessions.set(token, {
      identityId: identity.id,
      expires: this.now() + 3_600_000,
    });
    return { token, identity };
  }
}
