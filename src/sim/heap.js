// Binary min-heap of (int node, float priority). Lazy deletion is handled by callers.
export class Heap {
  constructor(cap = 1024) {
    this.n = new Int32Array(cap);
    this.p = new Float64Array(cap);
    this.size = 0;
  }
  clear() { this.size = 0; }
  grow() {
    const n = new Int32Array(this.n.length * 2); n.set(this.n); this.n = n;
    const p = new Float64Array(this.p.length * 2); p.set(this.p); this.p = p;
  }
  push(node, pr) {
    if (this.size >= this.n.length) this.grow();
    let i = this.size++;
    const N = this.n, P = this.p;
    while (i > 0) {
      const pa = (i - 1) >> 1;
      if (P[pa] <= pr) break;
      N[i] = N[pa]; P[i] = P[pa]; i = pa;
    }
    N[i] = node; P[i] = pr;
  }
  pop() {
    const N = this.n, P = this.p;
    const top = N[0];
    const s = --this.size;
    if (s > 0) {
      const ln = N[s], lp = P[s];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= s) break;
        const r = l + 1;
        const c = (r < s && P[r] < P[l]) ? r : l;
        if (P[c] >= lp) break;
        N[i] = N[c]; P[i] = P[c]; i = c;
      }
      N[i] = ln; P[i] = lp;
    }
    return top;
  }
}
