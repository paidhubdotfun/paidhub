// A mock req/res pair, so the suite calls the site's own API routes rather than a copy of them.
export function mockReq({ method = "GET", url = "/", body = null, query = {}, headers = {} } = {}) {
  return { method, url, body, query, headers };
}

export function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(payload) {
      this.body = payload;
      this.done = true;
      return this;
    },
  };
  return res;
}

export async function call(handler, req) {
  const res = mockRes();
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body || "{}") };
}
