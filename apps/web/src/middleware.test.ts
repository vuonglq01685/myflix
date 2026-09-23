import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { config, middleware } from './middleware';

describe('middleware — AC18 structured JSON log on every request', () => {
  it('matcher includes the root path (load-bearing: web healthcheck polls "/")', () => {
    expect(config.matcher).toContain('/');
  });

  it('emits one JSON-parseable log line describing the request before any redirect logic runs', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const request = new NextRequest('http://localhost:3000/browse', {
      headers: { cookie: 'refresh_token=t; pid=p' },
    });

    middleware(request);

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.msg).toBe('request');
    expect(parsed.method).toBe('GET');
    expect(parsed.path).toBe('/browse');
    expect(typeof parsed.level).toBe('number');
    spy.mockRestore();
  });
});
