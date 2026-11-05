var ln = Object.defineProperty;
var hn = (t, i, e) => i in t ? ln(t, i, { enumerable: !0, configurable: !0, writable: !0, value: e }) : t[i] = e;
var k = (t, i, e) => (hn(t, typeof i != "symbol" ? i + "" : i, e), e);
import * as S from "three";
import { Matrix4 as kt, Vector3 as Et, Vector2 as B, Euler as oi } from "three";
class ke {
  constructor() {
    k(this, "trs", new kt().identity());
    k(this, "rot", new Et(0, 0, 0));
    k(this, "scale", new B(1, 1));
    k(this, "trans", new Et(0, 0, 0));
  }
  multiply(i) {
    let e = new ke(), r = i.trs.multiply(this.trs);
    e.trans.setFromMatrixPosition(r), e.rot.applyMatrix4(new kt().extractRotation(r));
    let n = new Et().setFromMatrixScale(r);
    return e.scale.x = n.x, e.scale.y = n.y, e.trs = r, e;
  }
  update() {
    const i = new kt().identity();
    let e = i.makeTranslation(this.trans.x, this.trans.y, this.trans.z), r = i.makeRotationFromEuler(new oi(this.rot.x, this.rot.y, this.rot.z, oi.DefaultOrder)), n = i.makeScale(this.scale.x, this.scale.y, 1);
    this.trs = n.multiply(r).multiply(e);
  }
  matrix() {
    return this.trs;
  }
}
function fn(t) {
  const i = new ke();
  return i.rot.fromArray(t.rot), i.scale.fromArray(t.scale), i.trans.fromArray(t.trans), i;
}
var L = /* @__PURE__ */ ((t) => (t[t.Normal = 0] = "Normal", t[t.Multiply = 1] = "Multiply", t[t.ColorDodge = 2] = "ColorDodge", t[t.LinearDodge = 3] = "LinearDodge", t[t.Screen = 4] = "Screen", t[t.ClipToLower = 5] = "ClipToLower", t[t.SliceFromLower = 6] = "SliceFromLower", t))(L || {}), ir = /* @__PURE__ */ ((t) => (t[t.Mask = 0] = "Mask", t[t.Dodge = 1] = "Dodge", t))(ir || {});
class qe {
  constructor() {
    k(this, "type", "");
    k(this, "uuid", -1);
    k(this, "name");
    k(this, "enabled", !0);
    k(this, "zsort", 0);
    k(this, "transform", new ke());
    k(this, "children", []);
    k(this, "puppet", null);
    k(this, "threeObj", new S.Object3D());
    k(this, "parent", null);
    k(this, "lockToRoot", !1);
    k(this, "actualTransform", new ke());
    k(this, "actualZsort", 0);
  }
  updateTransform() {
    if (this.transform.update(), this.parent == null)
      this.actualTransform = this.transform, this.actualZsort = this.zsort;
    else {
      const i = new ke();
      i.rot = this.parent.actualTransform.rot.clone().add(this.transform.rot), i.trans = this.parent.actualTransform.trans.clone().add(this.transform.trans), i.scale = new S.Vector2(
        this.parent.actualTransform.scale.x * this.transform.scale.x,
        this.parent.actualTransform.scale.y * this.transform.scale.y
      ), this.actualTransform = i, this.actualZsort = this.parent.actualZsort + this.zsort;
    }
    this.threeObj.position.set(this.transform.trans.x, this.transform.trans.y, this.transform.trans.z), this.threeObj.scale.set(this.transform.scale.x, this.transform.scale.y, 1), this.threeObj.rotation.x = this.transform.rot.x, this.threeObj.rotation.y = this.transform.rot.y, this.threeObj.rotation.z = this.transform.rot.z, this.threeObj.renderOrder = -this.actualZsort;
  }
  onCreateMesh() {
  }
  onCreateMaterials() {
  }
  update() {
    this.updateTransform();
  }
  create() {
    this.onCreateMesh(), this.onCreateMaterials();
  }
}
class dn extends qe {
  constructor() {
    super(...arguments);
    k(this, "joints", []);
    k(this, "bindings", []);
  }
}
class Ee {
  constructor() {
    k(this, "vertices");
    k(this, "uvs");
    k(this, "indices");
    k(this, "origin");
    k(this, "gridAxes");
    this.vertices = [], this.indices = [], this.origin = new B(0, 0);
  }
  add(i, e) {
    this.vertices.push(i), this.uvs && this.uvs.push(e);
  }
  clearConnections() {
    this.indices.length = 0;
  }
  connect(i, e) {
    this.indices.push(i, e);
  }
  find(i) {
    for (let e = 0; e < this.vertices.length; e++)
      if (this.vertices[e].equals(i))
        return e;
    return -1;
  }
  isReady() {
    return this.indices.length !== 0 && this.indices.length % 3 === 0;
  }
  canTriangulate() {
    return this.isReady();
  }
  fixWinding() {
    if (!!this.isReady())
      for (let i = 0; i < this.indices.length; i += 3) {
        const e = i, r = this.vertices[this.indices[e + 0]], n = this.vertices[this.indices[e + 1]], a = this.vertices[this.indices[e + 2]];
        if ((n.x - r.x) * (a.y - r.y) - (n.y - r.y) * (a.x - r.x) < 0) {
          const o = this.indices[e + 1];
          this.indices[e + 1] = this.indices[e + 2], this.indices[e + 2] = o;
        }
      }
  }
  connectionsAtPoint(i) {
    let e = 0;
    for (const r of this.indices)
      r === i && e++;
    return e;
  }
  copy() {
    const i = new Ee();
    return i.vertices = this.vertices.slice(), this.uvs && (i.uvs = this.uvs.slice()), i.indices = this.indices.slice(), i.origin = new B(this.origin.x, this.origin.y), i;
  }
  static createQuadMesh(i, e, r = new B(6, 6), n = new B(0, 0)) {
    r.x = Math.max(2, r.x), r.y = Math.max(2, r.y);
    const a = new Ee(), l = /* @__PURE__ */ new Map(), o = i.x / r.x, c = i.y / r.y, s = e.z / r.x, h = e.w / r.y;
    for (let _ = 0; _ < r.y + 1; _++) {
      a.gridAxes || (a.gridAxes = [[]]), a.gridAxes[0].push(_ * c - n.y);
      for (let u = 0; u < r.x + 1; u++) {
        a.gridAxes[1] || (a.gridAxes[1] = []), a.gridAxes[1].push(u * o - n.x);
        const v = new B(u * o - n.x, _ * c - n.y), $ = new B(
          e.x + u * s,
          e.y + _ * h
        );
        a.vertices.push(v), a.uvs && a.uvs.push($), l.set([u, _], a.vertices.length - 1);
      }
    }
    const g = new B(
      Math.floor(r.x / 2),
      Math.floor(r.y / 2)
    );
    for (let _ = 0; _ < r.y; _++)
      for (let u = 0; u < r.x; u++) {
        const v = [u, _], $ = [u, _ + 1], C = [u + 1, _], E = [u + 1, _ + 1];
        u < g.x && _ < g.y || u >= g.x && _ >= g.y ? a.indices.push(
          l.get(v),
          l.get(C),
          l.get(E),
          l.get(v),
          l.get(E),
          l.get($)
        ) : a.indices.push(
          l.get(v),
          l.get($),
          l.get(C),
          l.get($),
          l.get(C),
          l.get(E)
        );
      }
    return a;
  }
  isGrid() {
    return this.gridAxes !== void 0 && this.gridAxes.length === 2 && this.gridAxes[0].length > 2 && this.gridAxes[1].length > 2;
  }
  clearGridIsDirty() {
    if (this.gridAxes === void 0 || this.gridAxes[0].length === 0 || this.gridAxes[1].length === 0)
      return !1;
    const i = () => (this.gridAxes[0].length = 0, this.gridAxes[1].length = 0, !0);
    if (this.vertices.length !== this.gridAxes[0].length * this.gridAxes[1].length)
      return i();
    let e = 0;
    for (const r of this.gridAxes[0])
      for (const n of this.gridAxes[1]) {
        if (!new B(n, r).equals(this.vertices[e]))
          return i();
        e += 1;
      }
    return !1;
  }
  regenerateGrid() {
    if (this.gridAxes === void 0 || this.gridAxes[0].length < 2 || this.gridAxes[1].length < 2)
      return !1;
    this.vertices.length = 0, this.uvs && (this.uvs.length = 0), this.indices.length = 0;
    const i = /* @__PURE__ */ new Map(), e = this.gridAxes[0][0], r = this.gridAxes[0][this.gridAxes[0].length - 1], n = this.gridAxes[1][0], a = this.gridAxes[1][this.gridAxes[1].length - 1], l = r - e, o = a - n;
    for (let s = 0; s < this.gridAxes[0].length; s++)
      for (let h = 0; h < this.gridAxes[1].length; h++) {
        const g = this.gridAxes[1][h], _ = this.gridAxes[0][s], u = new B(g, _), v = new B((g - n) / l, (_ - e) / o);
        this.vertices.push(u), this.uvs && this.uvs.push(v), i.set([h, s], this.vertices.length - 1);
      }
    const c = new B(n + l / 2, e + o / 2);
    for (let s = 0; s < this.gridAxes[0].length - 1; s++) {
      const h = this.gridAxes[0][s];
      for (let g = 0; g < this.gridAxes[1].length - 1; g++) {
        const _ = this.gridAxes[1][g], u = g, v = s, $ = [u, v], C = [u, v + 1], E = [u + 1, v], N = [u + 1, v + 1];
        _ < c.x && h < c.y || _ >= c.x && h >= c.y ? this.indices.push(
          i.get($),
          i.get(E),
          i.get(N),
          i.get($),
          i.get(N),
          i.get(C)
        ) : this.indices.push(
          i.get($),
          i.get(C),
          i.get(E),
          i.get(C),
          i.get(E),
          i.get(N)
        );
      }
    }
    return !0;
  }
  serialize() {
    const i = {
      verts: this.vertices.map((e) => [e.x, e.y]),
      indices: this.indices,
      origin: this.origin.toArray()
    };
    return this.uvs && this.uvs.length > 0 && (i.uvs = this.uvs.map((e) => [e.x, e.y])), this.gridAxes && this.gridAxes.length === 2 && (i.grid_axes = this.gridAxes), i;
  }
  static deserialize(i) {
    const e = new Ee();
    if (i.verts && Array.isArray(i.verts))
      for (let r = 0; r < i.verts.length; r += 2) {
        const n = i.verts[r], a = i.verts[r + 1];
        typeof n == "number" && typeof a == "number" ? e.vertices.push(new B(n, a)) : console.error("Unexpected values for vert coordinates:", n, a);
      }
    if (i.uvs && Array.isArray(i.uvs)) {
      e.uvs = [];
      for (let r = 0; r < i.uvs.length; r += 2) {
        const n = i.uvs[r], a = i.uvs[r + 1];
        typeof n == "number" && typeof a == "number" ? e.uvs.push(new B(n, a)) : console.error("Unexpected values for uv coordinates:", n, a);
      }
    }
    return i.indices && Array.isArray(i.indices) && (e.indices = i.indices), i.origin && Array.isArray(i.origin) && e.origin.fromArray(i.origin), i.grid_axes && Array.isArray(i.grid_axes) && (e.gridAxes = i.grid_axes), e;
  }
}
const rr = [
  { _blendmode: L.Normal, _constant: S.NormalBlending },
  { _blendmode: L.Screen, _constant: S.MultiplyBlending },
  { _blendmode: L.ColorDodge, _constant: S.MultiplyBlending },
  { _blendmode: L.Multiply, _constant: S.MultiplyBlending }
];
function nr(t, i, e, r) {
  t.create(), t.update(), e.add(t.threeObj);
  for (let n of t.children)
    nr(n, i, t.threeObj);
  return t.threeObj;
}
function un(t, i, e, r) {
  let n = nr(t.rootNode, i, i, t.textures);
  i.add(n);
  const a = function() {
    requestAnimationFrame(a), r.render(i, e);
  };
  return a(), {
    rootNode: n,
    animate: a
  };
}
const No = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  blend_modes: rr,
  renderPuppet: un
}, Symbol.toStringTag, { value: "Module" }));
class cn {
  constructor() {
    k(this, "source", -1);
    k(this, "mode", L.ClipToLower);
  }
}
class ar extends qe {
  constructor() {
    super(...arguments);
    k(this, "mesh", new Ee());
    k(this, "masks", []);
  }
  onCreateMesh() {
    super.onCreateMesh();
    const e = new S.BufferGeometry(), r = [], n = 3;
    for (let a of this.mesh.vertices) {
      const l = this.mesh.origin ? this.mesh.origin : new S.Vector2(0, 0);
      r.push(a.x + l.x, a.y + l.y, 0);
    }
    if (e.setAttribute(
      "position",
      new S.BufferAttribute(new Float32Array(r), n)
    ), this.mesh.uvs) {
      const a = [];
      this.mesh.uvs.map((o) => {
        a.push(o.x, o.y);
      }), e.setAttribute(
        "uv",
        new S.BufferAttribute(new Float32Array(a), 2)
      );
    }
    e.setIndex(this.mesh.indices), this.threeObj = new S.Mesh(e, new S.MeshNormalMaterial());
  }
  onCreateMaterials() {
    this.threeObj instanceof S.Mesh && this.threeObj.material && (this.enabled || (this.threeObj.material.opacity = 0), this.threeObj.material.alphaTest = 0.7), super.onCreateMaterials();
  }
}
class pn extends ar {
  onCreateMaterials() {
    if (this.threeObj instanceof S.Mesh) {
      console.log("mask material xd");
      const i = new S.MeshPhongMaterial({ color: "white" });
      i.depthWrite = !1, i.stencilWrite = !0, i.stencilRef = this.uuid, i.stencilFunc = S.AlwaysStencilFunc, i.stencilZPass = S.ReplaceStencilOp, this.threeObj.material = i;
    }
    super.onCreateMaterials();
  }
}
class _n extends ar {
  constructor() {
    super(...arguments);
    k(this, "textures", []);
    k(this, "opacity", 1);
    k(this, "mask_mode", ir.Mask);
    k(this, "mask_threshold", 0);
    k(this, "masked_by", []);
    k(this, "blend_mode", L.Normal);
  }
  onCreateMaterials() {
    const e = this.textures.map((r) => this.puppet.textures[r]);
    if (this.threeObj instanceof S.Mesh) {
      let r, n = rr.find((l) => l._blendmode === this.blend_mode);
      n === void 0 && (n = { _blendmode: L.Normal, _constant: S.NormalBlending });
      const { _constant: a } = n;
      if (e) {
        const l = e[0];
        r = new S.MeshBasicMaterial({ transparent: !0, blending: a, map: l, depthWrite: !1 }), r.stencilWrite = !0, this.masks.length > 0 ? (r.stencilRef = this.masks.map((o) => o.source)[0], r.stencilFunc = S.EqualStencilFunc, r.stencilFail = S.KeepStencilOp, r.stencilZFail = S.KeepStencilOp, r.stencilZPass = S.KeepStencilOp) : (r.depthWrite = !1, r.stencilWrite = !0, r.stencilRef = this.uuid, r.stencilFunc = S.AlwaysStencilFunc, r.stencilZPass = S.ReplaceStencilOp, r.stencilFail = S.ReplaceStencilOp, r.stencilZFail = S.ReplaceStencilOp, r.stencilZPass = S.ReplaceStencilOp);
      } else
        r = new S.MeshBasicMaterial({ color: "pink", transparent: !0, blending: a });
      this.threeObj.material = r;
    }
    super.onCreateMaterials();
  }
}
function Yt(t, i, e) {
  return e.puppet = t, e.type = i.type, e.uuid = i.uuid, e.name = i.name, e.enabled = i.enabled !== void 0 ? i.enabled : e.enabled, e.zsort = i.zsort !== void 0 ? i.zsort : e.zsort, e.transform = i.transform !== void 0 ? fn(i.transform) : e.transform, e.children = i.children !== void 0 ? i.children.map((r) => or(t, r, e)) : e.children, e.lockToRoot = i.children !== void 0 ? i.lockToRoot : e.lockToRoot, e;
}
function sr(t, i, e) {
  return e = Yt(t, i, e), e.mesh = Ee.deserialize(i.mesh), e.masks = i.masks !== void 0 ? i.masks.map((r) => {
    const n = new cn();
    if (r.mode)
      switch (i.blend_mode) {
        case "Mask":
          n.mode = L.ClipToLower;
          break;
        case "Dodge":
          n.mode = L.SliceFromLower;
          break;
        default:
          n.mode = L.Normal;
      }
    return n.source = r.source, n;
  }) : e.children, e;
}
function bn(t, i) {
  let e = new _n();
  if (e = sr(t, i, e), e.textures = i.textures, e.opacity = i.opacity, e.mask_mode = i.mask_mode, e.mask_threshold = i.mask_threshold, e.masked_by = i.masked_by, i.blend_mode)
    switch (i.blend_mode) {
      case "Multiply":
        e.blend_mode = L.Multiply;
        break;
      case "ColorDodge":
        e.blend_mode = L.ColorDodge;
        break;
      case "LinearDodge":
        e.blend_mode = L.LinearDodge;
        break;
      case "Screen":
        e.blend_mode = L.Screen;
        break;
      default:
        e.blend_mode = L.Normal;
    }
  return e;
}
function gn(t, i) {
  let e = new pn();
  return e = sr(t, i, e), console.log("Serialised a mask"), e;
}
function wn(t, i) {
  let e = new dn();
  return e = Yt(t, i, e), e.joints = i.joints, e.bindings = i.bindings, e;
}
function yn(t, i) {
  let e = new qe();
  return e = Yt(t, i, e), e;
}
function or(t, i, e = null) {
  let r = new qe();
  switch (i.type) {
    case "Part":
      r = bn(t, i);
      break;
    case "Mask":
      r = gn(t, i);
      break;
    case "PathDeform":
      r = wn(t, i);
      break;
    default:
      r = yn(t, i);
      break;
  }
  return r.parent = e, t.nodes.push(r), r;
}
const lr = 4294967295;
var hr = /* @__PURE__ */ ((t) => (t.OnlyAuthor = "onlyAuthor", t.OnlyLicensee = "onlyLicensee", t.Everyone = "everyone", t))(hr || {}), fr = /* @__PURE__ */ ((t) => (t.Prohibited = "prohibited", t.ViralLicense = "viralLicense", t.CopyleftLicense = "copyleftLicense", t))(fr || {}), dr = /* @__PURE__ */ ((t) => (t.Prohibited = "prohibited", t.AllowPersonal = "allowPersonal", t.AllowRedistribute = "allowRedistribute", t))(dr || {});
class ur {
  constructor() {
    k(this, "allowedUsers", "onlyAuthor");
    k(this, "allowViolence", !1);
    k(this, "allowSexual", !1);
    k(this, "allowCommercial", !1);
    k(this, "allowRedistribution", "prohibited");
    k(this, "allowModification", "prohibited");
    k(this, "requireAttribution", !1);
  }
}
class cr {
  constructor() {
    k(this, "name", "");
    k(this, "version", "1.0-alpha");
    k(this, "rigger", "");
    k(this, "artist", "");
    k(this, "rights", new ur());
    k(this, "copyright", "");
    k(this, "licenseURL", "");
    k(this, "contact", "");
    k(this, "reference", "");
    k(this, "thumbnailId", lr);
    k(this, "preservePixels", !1);
  }
}
class pr {
  constructor() {
    k(this, "meta", new cr());
    k(this, "textures", []);
    k(this, "rootNode", new qe());
    k(this, "nodes", []);
  }
}
function _r(t, i) {
  const e = new pr();
  return e.meta = t.meta, e.textures = i, e.rootNode = or(e, t.nodes), e.rootNode.transform.scale.y *= -1, e.rootNode.update(), e;
}
const Uo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  NO_THUMBNAIL: lr,
  PuppetAllowedUsers: hr,
  PuppetAllowedRedistribution: fr,
  PuppetAllowedModification: dr,
  PuppetUsageRights: ur,
  PuppetMeta: cr,
  Puppet: pr,
  deserializePuppet: _r
}, Symbol.toStringTag, { value: "Module" }));
class mn {
  constructor(i, e) {
    this.code = "", this.scopes = [["vars"]], this.bitFields = [], this.tmpVariableCount = 0, this.references = /* @__PURE__ */ new Map(), this.imports = [], this.reverseImports = /* @__PURE__ */ new Map(), this.useContextVariables = !1, this.importPath = i, this.useContextVariables = e;
  }
  generateVariable(i) {
    const e = [...this.scopes[this.scopes.length - 1]];
    return i && e.push(i), e.join(".");
  }
  generateOption(i) {
    switch (typeof i) {
      case "number":
        return i.toString();
      case "string":
        return this.generateVariable(i);
      case "function":
        return `${this.addImport(i)}.call(${this.generateVariable()}, vars)`;
    }
  }
  generateError(i) {
    this.pushCode(`throw new Error(${i});`);
  }
  generateTmpVariable() {
    return "$tmp" + this.tmpVariableCount++;
  }
  pushCode(i) {
    this.code += i + `
`;
  }
  pushPath(i) {
    i && this.scopes[this.scopes.length - 1].push(i);
  }
  popPath(i) {
    i && this.scopes[this.scopes.length - 1].pop();
  }
  pushScope(i) {
    this.scopes.push([i]);
  }
  popScope() {
    this.scopes.pop();
  }
  addImport(i) {
    if (!this.importPath)
      return `(${i})`;
    let e = this.reverseImports.get(i);
    return e || (e = this.imports.push(i) - 1, this.reverseImports.set(i, e)), `${this.importPath}[${e}]`;
  }
  addReference(i) {
    this.references.has(i) || this.references.set(i, { resolved: !1, requested: !1 });
  }
  markResolved(i) {
    const e = this.references.get(i);
    e && (e.resolved = !0);
  }
  markRequested(i) {
    i.forEach((e) => {
      const r = this.references.get(e);
      r && (r.requested = !0);
    });
  }
  getUnresolvedReferences() {
    return Array.from(this.references).filter(([i, e]) => !e.resolved && !e.requested).map(([i, e]) => i);
  }
}
const G = /* @__PURE__ */ new Map(), fe = "___parser_", Y = {
  uint8: 1,
  uint16le: 2,
  uint16be: 2,
  uint32le: 4,
  uint32be: 4,
  int8: 1,
  int16le: 2,
  int16be: 2,
  int32le: 4,
  int32be: 4,
  int64be: 8,
  int64le: 8,
  uint64be: 8,
  uint64le: 8,
  floatle: 4,
  floatbe: 4,
  doublele: 8,
  doublebe: 8
}, nt = {
  uint8: "Uint8",
  uint16le: "Uint16",
  uint16be: "Uint16",
  uint32le: "Uint32",
  uint32be: "Uint32",
  int8: "Int8",
  int16le: "Int16",
  int16be: "Int16",
  int32le: "Int32",
  int32be: "Int32",
  int64be: "BigInt64",
  int64le: "BigInt64",
  uint64be: "BigUint64",
  uint64le: "BigUint64",
  floatle: "Float32",
  floatbe: "Float32",
  doublele: "Float64",
  doublebe: "Float64"
}, at = {
  uint8: !1,
  uint16le: !0,
  uint16be: !1,
  uint32le: !0,
  uint32be: !1,
  int8: !1,
  int16le: !0,
  int16be: !1,
  int32le: !0,
  int32be: !1,
  int64be: !1,
  int64le: !0,
  uint64be: !1,
  uint64le: !0,
  floatle: !0,
  floatbe: !1,
  doublele: !0,
  doublebe: !1
};
class Z {
  constructor() {
    this.varName = "", this.type = "", this.options = {}, this.endian = "be", this.useContextVariables = !1;
  }
  static start() {
    return new Z();
  }
  primitiveGenerateN(i, e) {
    const r = nt[i], n = at[i];
    e.pushCode(`${e.generateVariable(this.varName)} = dataView.get${r}(offset, ${n});`), e.pushCode(`offset += ${Y[i]};`);
  }
  primitiveN(i, e, r) {
    return this.setNextParser(i, e, r);
  }
  useThisEndian(i) {
    return i + this.endian.toLowerCase();
  }
  uint8(i, e = {}) {
    return this.primitiveN("uint8", i, e);
  }
  uint16(i, e = {}) {
    return this.primitiveN(this.useThisEndian("uint16"), i, e);
  }
  uint16le(i, e = {}) {
    return this.primitiveN("uint16le", i, e);
  }
  uint16be(i, e = {}) {
    return this.primitiveN("uint16be", i, e);
  }
  uint32(i, e = {}) {
    return this.primitiveN(this.useThisEndian("uint32"), i, e);
  }
  uint32le(i, e = {}) {
    return this.primitiveN("uint32le", i, e);
  }
  uint32be(i, e = {}) {
    return this.primitiveN("uint32be", i, e);
  }
  int8(i, e = {}) {
    return this.primitiveN("int8", i, e);
  }
  int16(i, e = {}) {
    return this.primitiveN(this.useThisEndian("int16"), i, e);
  }
  int16le(i, e = {}) {
    return this.primitiveN("int16le", i, e);
  }
  int16be(i, e = {}) {
    return this.primitiveN("int16be", i, e);
  }
  int32(i, e = {}) {
    return this.primitiveN(this.useThisEndian("int32"), i, e);
  }
  int32le(i, e = {}) {
    return this.primitiveN("int32le", i, e);
  }
  int32be(i, e = {}) {
    return this.primitiveN("int32be", i, e);
  }
  bigIntVersionCheck() {
    if (!DataView.prototype.getBigInt64)
      throw new Error("BigInt64 is unsupported on this runtime");
  }
  int64(i, e = {}) {
    return this.bigIntVersionCheck(), this.primitiveN(this.useThisEndian("int64"), i, e);
  }
  int64be(i, e = {}) {
    return this.bigIntVersionCheck(), this.primitiveN("int64be", i, e);
  }
  int64le(i, e = {}) {
    return this.bigIntVersionCheck(), this.primitiveN("int64le", i, e);
  }
  uint64(i, e = {}) {
    return this.bigIntVersionCheck(), this.primitiveN(this.useThisEndian("uint64"), i, e);
  }
  uint64be(i, e = {}) {
    return this.bigIntVersionCheck(), this.primitiveN("uint64be", i, e);
  }
  uint64le(i, e = {}) {
    return this.bigIntVersionCheck(), this.primitiveN("uint64le", i, e);
  }
  floatle(i, e = {}) {
    return this.primitiveN("floatle", i, e);
  }
  floatbe(i, e = {}) {
    return this.primitiveN("floatbe", i, e);
  }
  doublele(i, e = {}) {
    return this.primitiveN("doublele", i, e);
  }
  doublebe(i, e = {}) {
    return this.primitiveN("doublebe", i, e);
  }
  bitN(i, e, r) {
    return r.length = i, this.setNextParser("bit", e, r);
  }
  bit1(i, e = {}) {
    return this.bitN(1, i, e);
  }
  bit2(i, e = {}) {
    return this.bitN(2, i, e);
  }
  bit3(i, e = {}) {
    return this.bitN(3, i, e);
  }
  bit4(i, e = {}) {
    return this.bitN(4, i, e);
  }
  bit5(i, e = {}) {
    return this.bitN(5, i, e);
  }
  bit6(i, e = {}) {
    return this.bitN(6, i, e);
  }
  bit7(i, e = {}) {
    return this.bitN(7, i, e);
  }
  bit8(i, e = {}) {
    return this.bitN(8, i, e);
  }
  bit9(i, e = {}) {
    return this.bitN(9, i, e);
  }
  bit10(i, e = {}) {
    return this.bitN(10, i, e);
  }
  bit11(i, e = {}) {
    return this.bitN(11, i, e);
  }
  bit12(i, e = {}) {
    return this.bitN(12, i, e);
  }
  bit13(i, e = {}) {
    return this.bitN(13, i, e);
  }
  bit14(i, e = {}) {
    return this.bitN(14, i, e);
  }
  bit15(i, e = {}) {
    return this.bitN(15, i, e);
  }
  bit16(i, e = {}) {
    return this.bitN(16, i, e);
  }
  bit17(i, e = {}) {
    return this.bitN(17, i, e);
  }
  bit18(i, e = {}) {
    return this.bitN(18, i, e);
  }
  bit19(i, e = {}) {
    return this.bitN(19, i, e);
  }
  bit20(i, e = {}) {
    return this.bitN(20, i, e);
  }
  bit21(i, e = {}) {
    return this.bitN(21, i, e);
  }
  bit22(i, e = {}) {
    return this.bitN(22, i, e);
  }
  bit23(i, e = {}) {
    return this.bitN(23, i, e);
  }
  bit24(i, e = {}) {
    return this.bitN(24, i, e);
  }
  bit25(i, e = {}) {
    return this.bitN(25, i, e);
  }
  bit26(i, e = {}) {
    return this.bitN(26, i, e);
  }
  bit27(i, e = {}) {
    return this.bitN(27, i, e);
  }
  bit28(i, e = {}) {
    return this.bitN(28, i, e);
  }
  bit29(i, e = {}) {
    return this.bitN(29, i, e);
  }
  bit30(i, e = {}) {
    return this.bitN(30, i, e);
  }
  bit31(i, e = {}) {
    return this.bitN(31, i, e);
  }
  bit32(i, e = {}) {
    return this.bitN(32, i, e);
  }
  namely(i) {
    return G.set(i, this), this.alias = i, this;
  }
  skip(i, e = {}) {
    return this.seek(i, e);
  }
  seek(i, e = {}) {
    if (e.assert)
      throw new Error("assert option on seek is not allowed.");
    return this.setNextParser("seek", "", { length: i });
  }
  string(i, e) {
    if (!e.zeroTerminated && !e.length && !e.greedy)
      throw new Error("One of length, zeroTerminated, or greedy must be defined for string.");
    if ((e.zeroTerminated || e.length) && e.greedy)
      throw new Error("greedy is mutually exclusive with length and zeroTerminated for string.");
    if (e.stripNull && !(e.length || e.greedy))
      throw new Error("length or greedy must be defined if stripNull is enabled.");
    return e.encoding = e.encoding || "utf8", this.setNextParser("string", i, e);
  }
  buffer(i, e) {
    if (!e.length && !e.readUntil)
      throw new Error("length or readUntil must be defined for buffer.");
    return this.setNextParser("buffer", i, e);
  }
  wrapped(i, e) {
    if (typeof e != "object" && typeof i == "object" && (e = i, i = ""), !e || !e.wrapper || !e.type)
      throw new Error("Both wrapper and type must be defined for wrapped.");
    if (!e.length && !e.readUntil)
      throw new Error("length or readUntil must be defined for wrapped.");
    return this.setNextParser("wrapper", i, e);
  }
  array(i, e) {
    if (!e.readUntil && !e.length && !e.lengthInBytes)
      throw new Error("One of readUntil, length and lengthInBytes must be defined for array.");
    if (!e.type)
      throw new Error("type is required for array.");
    if (typeof e.type == "string" && !G.has(e.type) && !(e.type in Y))
      throw new Error(`Array element type "${e.type}" is unkown.`);
    return this.setNextParser("array", i, e);
  }
  choice(i, e) {
    if (typeof e != "object" && typeof i == "object" && (e = i, i = ""), !e)
      throw new Error("tag and choices are are required for choice.");
    if (!e.tag)
      throw new Error("tag is requird for choice.");
    if (!e.choices)
      throw new Error("choices is required for choice.");
    for (const r in e.choices) {
      const n = parseInt(r, 10), a = e.choices[n];
      if (isNaN(n))
        throw new Error(`Choice key "${r}" is not a number.`);
      if (typeof a == "string" && !G.has(a) && !(a in Y))
        throw new Error(`Choice type "${a}" is unkown.`);
    }
    return this.setNextParser("choice", i, e);
  }
  nest(i, e) {
    if (typeof e != "object" && typeof i == "object" && (e = i, i = ""), !e || !e.type)
      throw new Error("type is required for nest.");
    if (!(e.type instanceof Z) && !G.has(e.type))
      throw new Error("type must be a known parser name or a Parser object.");
    if (!(e.type instanceof Z) && !i)
      throw new Error("type must be a Parser object if the variable name is omitted.");
    return this.setNextParser("nest", i, e);
  }
  pointer(i, e) {
    if (!e.offset)
      throw new Error("offset is required for pointer.");
    if (!e.type)
      throw new Error("type is required for pointer.");
    if (typeof e.type == "string" && !(e.type in Y) && !G.has(e.type))
      throw new Error(`Pointer type "${e.type}" is unkown.`);
    return this.setNextParser("pointer", i, e);
  }
  saveOffset(i, e = {}) {
    return this.setNextParser("saveOffset", i, e);
  }
  endianness(i) {
    switch (i.toLowerCase()) {
      case "little":
        this.endian = "le";
        break;
      case "big":
        this.endian = "be";
        break;
      default:
        throw new Error('endianness must be one of "little" or "big"');
    }
    return this;
  }
  endianess(i) {
    return this.endianness(i);
  }
  useContextVars(i = !0) {
    return this.useContextVariables = i, this;
  }
  create(i) {
    if (!(i instanceof Function))
      throw new Error("Constructor must be a Function object.");
    return this.constructorFn = i, this;
  }
  getContext(i) {
    const e = new mn(i, this.useContextVariables);
    return e.pushCode("var dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);"), this.alias ? (this.addAliasedCode(e), e.pushCode(`return ${fe + this.alias}(0).result;`)) : this.addRawCode(e), e;
  }
  getCode() {
    const i = "imports";
    return this.getContext(i).code;
  }
  addRawCode(i) {
    i.pushCode("var offset = 0;"), i.pushCode(`var vars = ${this.constructorFn ? "new constructorFn()" : "{}"};`), i.pushCode("vars.$parent = null;"), i.pushCode("vars.$root = vars;"), this.generate(i), this.resolveReferences(i), i.pushCode("delete vars.$parent;"), i.pushCode("delete vars.$root;"), i.pushCode("return vars;");
  }
  addAliasedCode(i) {
    return i.pushCode(`function ${fe + this.alias}(offset, context) {`), i.pushCode(`var vars = ${this.constructorFn ? "new constructorFn()" : "{}"};`), i.pushCode("var ctx = Object.assign({$parent: null, $root: vars}, context || {});"), i.pushCode("vars = Object.assign(vars, ctx);"), this.generate(i), i.markResolved(this.alias), this.resolveReferences(i), i.pushCode("Object.keys(ctx).forEach(function (item) { delete vars[item]; });"), i.pushCode("return { offset: offset, result: vars };"), i.pushCode("}"), i;
  }
  resolveReferences(i) {
    const e = i.getUnresolvedReferences();
    i.markRequested(e), e.forEach((r) => {
      var n;
      (n = G.get(r)) === null || n === void 0 || n.addAliasedCode(i);
    });
  }
  compile() {
    const i = "imports", e = this.getContext(i);
    this.compiled = new Function(i, "TextDecoder", `return function (buffer, constructorFn) { ${e.code} };`)(e.imports, TextDecoder);
  }
  sizeOf() {
    let i = NaN;
    if (Object.keys(Y).indexOf(this.type) >= 0)
      i = Y[this.type];
    else if (this.type === "string" && typeof this.options.length == "number")
      i = this.options.length;
    else if (this.type === "buffer" && typeof this.options.length == "number")
      i = this.options.length;
    else if (this.type === "array" && typeof this.options.length == "number") {
      let e = NaN;
      typeof this.options.type == "string" ? e = Y[this.options.type] : this.options.type instanceof Z && (e = this.options.type.sizeOf()), i = this.options.length * e;
    } else
      this.type === "seek" ? i = this.options.length : this.type === "nest" ? i = this.options.type.sizeOf() : this.type || (i = 0);
    return this.next && (i += this.next.sizeOf()), i;
  }
  parse(i) {
    return this.compiled || this.compile(), this.compiled(i, this.constructorFn);
  }
  setNextParser(i, e, r) {
    const n = new Z();
    return n.type = i, n.varName = e, n.options = r, n.endian = this.endian, this.head ? this.head.next = n : this.next = n, this.head = n, this;
  }
  generate(i) {
    if (this.type) {
      switch (this.type) {
        case "uint8":
        case "uint16le":
        case "uint16be":
        case "uint32le":
        case "uint32be":
        case "int8":
        case "int16le":
        case "int16be":
        case "int32le":
        case "int32be":
        case "int64be":
        case "int64le":
        case "uint64be":
        case "uint64le":
        case "floatle":
        case "floatbe":
        case "doublele":
        case "doublebe":
          this.primitiveGenerateN(this.type, i);
          break;
        case "bit":
          this.generateBit(i);
          break;
        case "string":
          this.generateString(i);
          break;
        case "buffer":
          this.generateBuffer(i);
          break;
        case "seek":
          this.generateSeek(i);
          break;
        case "nest":
          this.generateNest(i);
          break;
        case "array":
          this.generateArray(i);
          break;
        case "choice":
          this.generateChoice(i);
          break;
        case "pointer":
          this.generatePointer(i);
          break;
        case "saveOffset":
          this.generateSaveOffset(i);
          break;
        case "wrapper":
          this.generateWrapper(i);
          break;
      }
      this.type !== "bit" && this.generateAssert(i);
    }
    const e = i.generateVariable(this.varName);
    return this.options.formatter && this.type !== "bit" && this.generateFormatter(i, e, this.options.formatter), this.generateNext(i);
  }
  generateAssert(i) {
    if (!this.options.assert)
      return;
    const e = i.generateVariable(this.varName);
    switch (typeof this.options.assert) {
      case "function":
        {
          const r = i.addImport(this.options.assert);
          i.pushCode(`if (!${r}.call(vars, ${e})) {`);
        }
        break;
      case "number":
        i.pushCode(`if (${this.options.assert} !== ${e}) {`);
        break;
      case "string":
        i.pushCode(`if (${JSON.stringify(this.options.assert)} !== ${e}) {`);
        break;
      default:
        throw new Error("assert option must be a string, number or a function.");
    }
    i.generateError(`"Assertion error: ${e} is " + ${JSON.stringify(this.options.assert.toString())}`), i.pushCode("}");
  }
  generateNext(i) {
    return this.next && (i = this.next.generate(i)), i;
  }
  generateBit(i) {
    const e = JSON.parse(JSON.stringify(this));
    if (e.options = this.options, e.generateAssert = this.generateAssert.bind(this), e.generateFormatter = this.generateFormatter.bind(this), e.varName = i.generateVariable(e.varName), i.bitFields.push(e), !this.next || this.next && ["bit", "nest"].indexOf(this.next.type) < 0) {
      const r = i.generateTmpVariable();
      i.pushCode(`var ${r} = 0;`);
      const n = (h = 0) => {
        let g = 0;
        for (let _ = h; _ < i.bitFields.length; _++) {
          const u = i.bitFields[_].options.length;
          if (g + u > 32)
            break;
          g += u;
        }
        return g;
      }, a = (h) => (h <= 8 ? (i.pushCode(`${r} = dataView.getUint8(offset);`), h = 8) : h <= 16 ? (i.pushCode(`${r} = dataView.getUint16(offset);`), h = 16) : h <= 24 ? (i.pushCode(`${r} = (dataView.getUint16(offset) << 8) | dataView.getUint8(offset + 2);`), h = 24) : (i.pushCode(`${r} = dataView.getUint32(offset);`), h = 32), i.pushCode(`offset += ${h / 8};`), h);
      let l = 0;
      const o = this.endian === "be";
      let c = 0, s = 0;
      i.bitFields.forEach((h, g) => {
        let _ = h.options.length;
        if (_ > s) {
          if (s) {
            const $ = -1 >>> 32 - s;
            i.pushCode(`${h.varName} = (${r} & 0x${$.toString(16)}) << ${_ - s};`), _ -= s;
          }
          l = 0, s = c = a(n(g) - s);
        }
        const u = o ? c - l - _ : l, v = -1 >>> 32 - _;
        i.pushCode(`${h.varName} ${_ < h.options.length ? "|=" : "="} ${r} >> ${u} & 0x${v.toString(16)};`), h.options.length === 32 && i.pushCode(`${h.varName} >>>= 0`), h.options.assert && h.generateAssert(i), h.options.formatter && h.generateFormatter(i, h.varName, h.options.formatter), l += _, s -= _;
      }), i.bitFields = [];
    }
  }
  generateSeek(i) {
    const e = i.generateOption(this.options.length);
    i.pushCode(`offset += ${e};`);
  }
  generateString(i) {
    const e = i.generateVariable(this.varName), r = i.generateTmpVariable(), n = this.options.encoding, a = n.toLowerCase() === "hex", l = 'b => b.toString(16).padStart(2, "0")';
    if (this.options.length && this.options.zeroTerminated) {
      const o = this.options.length;
      i.pushCode(`var ${r} = offset;`), i.pushCode(`while(dataView.getUint8(offset++) !== 0 && offset - ${r} < ${o});`);
      const c = `offset - ${r} < ${o} ? offset - 1 : offset`;
      i.pushCode(a ? `${e} = Array.from(buffer.subarray(${r}, ${c}), ${l}).join('');` : `${e} = new TextDecoder('${n}').decode(buffer.subarray(${r}, ${c}));`);
    } else if (this.options.length) {
      const o = i.generateOption(this.options.length);
      i.pushCode(a ? `${e} = Array.from(buffer.subarray(offset, offset + ${o}), ${l}).join('');` : `${e} = new TextDecoder('${n}').decode(buffer.subarray(offset, offset + ${o}));`), i.pushCode(`offset += ${o};`);
    } else
      this.options.zeroTerminated ? (i.pushCode(`var ${r} = offset;`), i.pushCode("while(dataView.getUint8(offset++) !== 0);"), i.pushCode(a ? `${e} = Array.from(buffer.subarray(${r}, offset - 1), ${l}).join('');` : `${e} = new TextDecoder('${n}').decode(buffer.subarray(${r}, offset - 1));`)) : this.options.greedy && (i.pushCode(`var ${r} = offset;`), i.pushCode("while(buffer.length > offset++);"), i.pushCode(a ? `${e} = Array.from(buffer.subarray(${r}, offset), ${l}).join('');` : `${e} = new TextDecoder('${n}').decode(buffer.subarray(${r}, offset));`));
    this.options.stripNull && i.pushCode(`${e} = ${e}.replace(/\\x00+$/g, '')`);
  }
  generateBuffer(i) {
    const e = i.generateVariable(this.varName);
    if (typeof this.options.readUntil == "function") {
      const r = this.options.readUntil, n = i.generateTmpVariable(), a = i.generateTmpVariable();
      i.pushCode(`var ${n} = offset;`), i.pushCode(`var ${a} = 0;`), i.pushCode("while (offset < buffer.length) {"), i.pushCode(`${a} = dataView.getUint8(offset);`);
      const l = i.addImport(r);
      i.pushCode(`if (${l}.call(${i.generateVariable()}, ${a}, buffer.subarray(offset))) break;`), i.pushCode("offset += 1;"), i.pushCode("}"), i.pushCode(`${e} = buffer.subarray(${n}, offset);`);
    } else if (this.options.readUntil === "eof")
      i.pushCode(`${e} = buffer.subarray(offset);`);
    else {
      const r = i.generateOption(this.options.length);
      i.pushCode(`${e} = buffer.subarray(offset, offset + ${r});`), i.pushCode(`offset += ${r};`);
    }
    this.options.clone && i.pushCode(`${e} = buffer.constructor.from(${e});`);
  }
  generateArray(i) {
    const e = i.generateOption(this.options.length), r = i.generateOption(this.options.lengthInBytes), n = this.options.type, a = i.generateTmpVariable(), l = i.generateVariable(this.varName), o = i.generateTmpVariable(), c = this.options.key, s = typeof c == "string";
    if (s ? i.pushCode(`${l} = {};`) : i.pushCode(`${l} = [];`), typeof this.options.readUntil == "function" ? i.pushCode("do {") : this.options.readUntil === "eof" ? i.pushCode(`for (var ${a} = 0; offset < buffer.length; ${a}++) {`) : r !== void 0 ? i.pushCode(`for (var ${a} = offset + ${r}; offset < ${a}; ) {`) : i.pushCode(`for (var ${a} = ${e}; ${a} > 0; ${a}--) {`), typeof n == "string")
      if (G.get(n)) {
        const h = i.generateTmpVariable();
        if (i.pushCode(`var ${h} = ${fe + n}(offset, {`), i.useContextVariables) {
          const g = i.generateVariable();
          i.pushCode(`$parent: ${g},`), i.pushCode(`$root: ${g}.$root,`), !this.options.readUntil && r === void 0 && i.pushCode(`$index: ${e} - ${a},`);
        }
        i.pushCode("});"), i.pushCode(`var ${o} = ${h}.result; offset = ${h}.offset;`), n !== this.alias && i.addReference(n);
      } else {
        const h = nt[n], g = at[n];
        i.pushCode(`var ${o} = dataView.get${h}(offset, ${g});`), i.pushCode(`offset += ${Y[n]};`);
      }
    else if (n instanceof Z) {
      i.pushCode(`var ${o} = {};`);
      const h = i.generateVariable();
      i.pushScope(o), i.useContextVariables && (i.pushCode(`${o}.$parent = ${h};`), i.pushCode(`${o}.$root = ${h}.$root;`), !this.options.readUntil && r === void 0 && i.pushCode(`${o}.$index = ${e} - ${a};`)), n.generate(i), i.useContextVariables && (i.pushCode(`delete ${o}.$parent;`), i.pushCode(`delete ${o}.$root;`), i.pushCode(`delete ${o}.$index;`)), i.popScope();
    }
    if (s ? i.pushCode(`${l}[${o}.${c}] = ${o};`) : i.pushCode(`${l}.push(${o});`), i.pushCode("}"), typeof this.options.readUntil == "function") {
      const h = this.options.readUntil, g = i.addImport(h);
      i.pushCode(`while (!${g}.call(${i.generateVariable()}, ${o}, buffer.subarray(offset)));`);
    }
  }
  generateChoiceCase(i, e, r) {
    if (typeof r == "string") {
      const n = i.generateVariable(this.varName);
      if (G.has(r)) {
        const a = i.generateTmpVariable();
        i.pushCode(`var ${a} = ${fe + r}(offset, {`), i.useContextVariables && (i.pushCode(`$parent: ${n}.$parent,`), i.pushCode(`$root: ${n}.$root,`)), i.pushCode("});"), i.pushCode(`${n} = ${a}.result; offset = ${a}.offset;`), r !== this.alias && i.addReference(r);
      } else {
        const a = nt[r], l = at[r];
        i.pushCode(`${n} = dataView.get${a}(offset, ${l});`), i.pushCode(`offset += ${Y[r]}`);
      }
    } else
      r instanceof Z && (i.pushPath(e), r.generate(i), i.popPath(e));
  }
  generateChoice(i) {
    const e = i.generateOption(this.options.tag), r = i.generateVariable(this.varName);
    if (this.varName && (i.pushCode(`${r} = {};`), i.useContextVariables)) {
      const n = i.generateVariable();
      i.pushCode(`${r}.$parent = ${n};`), i.pushCode(`${r}.$root = ${n}.$root;`);
    }
    i.pushCode(`switch(${e}) {`);
    for (const n in this.options.choices) {
      const a = parseInt(n, 10), l = this.options.choices[a];
      i.pushCode(`case ${a}:`), this.generateChoiceCase(i, this.varName, l), i.pushCode("break;");
    }
    i.pushCode("default:"), this.options.defaultChoice ? this.generateChoiceCase(i, this.varName, this.options.defaultChoice) : i.generateError(`"Met undefined tag value " + ${e} + " at choice"`), i.pushCode("}"), this.varName && i.useContextVariables && (i.pushCode(`delete ${r}.$parent;`), i.pushCode(`delete ${r}.$root;`));
  }
  generateNest(i) {
    const e = i.generateVariable(this.varName);
    if (this.options.type instanceof Z) {
      if (this.varName && (i.pushCode(`${e} = {};`), i.useContextVariables)) {
        const r = i.generateVariable();
        i.pushCode(`${e}.$parent = ${r};`), i.pushCode(`${e}.$root = ${r}.$root;`);
      }
      i.pushPath(this.varName), this.options.type.generate(i), i.popPath(this.varName), this.varName && i.useContextVariables && i.useContextVariables && (i.pushCode(`delete ${e}.$parent;`), i.pushCode(`delete ${e}.$root;`));
    } else if (G.has(this.options.type)) {
      const r = i.generateTmpVariable();
      if (i.pushCode(`var ${r} = ${fe + this.options.type}(offset, {`), i.useContextVariables) {
        const n = i.generateVariable();
        i.pushCode(`$parent: ${n},`), i.pushCode(`$root: ${n}.$root,`);
      }
      i.pushCode("});"), i.pushCode(`${e} = ${r}.result; offset = ${r}.offset;`), this.options.type !== this.alias && i.addReference(this.options.type);
    }
  }
  generateWrapper(i) {
    const e = i.generateVariable(this.varName), r = i.generateTmpVariable();
    if (typeof this.options.readUntil == "function") {
      const c = this.options.readUntil, s = i.generateTmpVariable(), h = i.generateTmpVariable();
      i.pushCode(`var ${s} = offset;`), i.pushCode(`var ${h} = 0;`), i.pushCode("while (offset < buffer.length) {"), i.pushCode(`${h} = dataView.getUint8(offset);`);
      const g = i.addImport(c);
      i.pushCode(`if (${g}.call(${i.generateVariable()}, ${h}, buffer.subarray(offset))) break;`), i.pushCode("offset += 1;"), i.pushCode("}"), i.pushCode(`${r} = buffer.subarray(${s}, offset);`);
    } else if (this.options.readUntil === "eof")
      i.pushCode(`${r} = buffer.subarray(offset);`);
    else {
      const c = i.generateOption(this.options.length);
      i.pushCode(`${r} = buffer.subarray(offset, offset + ${c});`), i.pushCode(`offset += ${c};`);
    }
    this.options.clone && i.pushCode(`${r} = buffer.constructor.from(${r});`);
    const n = i.generateTmpVariable(), a = i.generateTmpVariable(), l = i.generateTmpVariable(), o = i.addImport(this.options.wrapper);
    if (i.pushCode(`${r} = ${o}.call(this, ${r}).subarray(0);`), i.pushCode(`var ${n} = buffer;`), i.pushCode(`var ${a} = offset;`), i.pushCode(`var ${l} = dataView;`), i.pushCode(`buffer = ${r};`), i.pushCode("offset = 0;"), i.pushCode("dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);"), this.options.type instanceof Z)
      this.varName && i.pushCode(`${e} = {};`), i.pushPath(this.varName), this.options.type.generate(i), i.popPath(this.varName);
    else if (G.has(this.options.type)) {
      const c = i.generateTmpVariable();
      i.pushCode(`var ${c} = ${fe + this.options.type}(0);`), i.pushCode(`${e} = ${c}.result;`), this.options.type !== this.alias && i.addReference(this.options.type);
    }
    i.pushCode(`buffer = ${n};`), i.pushCode(`dataView = ${l};`), i.pushCode(`offset = ${a};`);
  }
  generateFormatter(i, e, r) {
    if (typeof r == "function") {
      const n = i.addImport(r);
      i.pushCode(`${e} = ${n}.call(${i.generateVariable()}, ${e});`);
    }
  }
  generatePointer(i) {
    const e = this.options.type, r = i.generateOption(this.options.offset), n = i.generateTmpVariable(), a = i.generateVariable(this.varName);
    if (i.pushCode(`var ${n} = offset;`), i.pushCode(`offset = ${r};`), this.options.type instanceof Z) {
      if (i.pushCode(`${a} = {};`), i.useContextVariables) {
        const l = i.generateVariable();
        i.pushCode(`${a}.$parent = ${l};`), i.pushCode(`${a}.$root = ${l}.$root;`);
      }
      i.pushPath(this.varName), this.options.type.generate(i), i.popPath(this.varName), i.useContextVariables && (i.pushCode(`delete ${a}.$parent;`), i.pushCode(`delete ${a}.$root;`));
    } else if (G.has(this.options.type)) {
      const l = i.generateTmpVariable();
      if (i.pushCode(`var ${l} = ${fe + this.options.type}(offset, {`), i.useContextVariables) {
        const o = i.generateVariable();
        i.pushCode(`$parent: ${o},`), i.pushCode(`$root: ${o}.$root,`);
      }
      i.pushCode("});"), i.pushCode(`${a} = ${l}.result; offset = ${l}.offset;`), this.options.type !== this.alias && i.addReference(this.options.type);
    } else if (Object.keys(Y).indexOf(this.options.type) >= 0) {
      const l = nt[e], o = at[e];
      i.pushCode(`${a} = dataView.get${l}(offset, ${o});`), i.pushCode(`offset += ${Y[e]};`);
    }
    i.pushCode(`offset = ${n};`);
  }
  generateSaveOffset(i) {
    const e = i.generateVariable(this.varName);
    i.pushCode(`${e} = offset`);
  }
}
(function(t) {
  if (t.TextEncoder && t.TextDecoder)
    return !1;
  function i(r = "utf-8") {
    if (r !== "utf-8")
      throw new RangeError(`Failed to construct 'TextEncoder': The encoding label provided ('${r}') is invalid.`);
  }
  Object.defineProperty(i.prototype, "encoding", {
    value: "utf-8"
  }), i.prototype.encode = function(r, n = { stream: !1 }) {
    if (n.stream)
      throw new Error("Failed to encode: the 'stream' option is unsupported.");
    let a = 0;
    const l = r.length;
    let o = 0, c = Math.max(32, l + (l >> 1) + 7), s = new Uint8Array(c >> 3 << 3);
    for (; a < l; ) {
      let h = r.charCodeAt(a++);
      if (h >= 55296 && h <= 56319) {
        if (a < l) {
          const g = r.charCodeAt(a);
          (g & 64512) === 56320 && (++a, h = ((h & 1023) << 10) + (g & 1023) + 65536);
        }
        if (h >= 55296 && h <= 56319)
          continue;
      }
      if (o + 4 > s.length) {
        c += 8, c *= 1 + a / r.length * 2, c = c >> 3 << 3;
        const g = new Uint8Array(c);
        g.set(s), s = g;
      }
      if ((h & 4294967168) === 0) {
        s[o++] = h;
        continue;
      } else if ((h & 4294965248) === 0)
        s[o++] = h >> 6 & 31 | 192;
      else if ((h & 4294901760) === 0)
        s[o++] = h >> 12 & 15 | 224, s[o++] = h >> 6 & 63 | 128;
      else if ((h & 4292870144) === 0)
        s[o++] = h >> 18 & 7 | 240, s[o++] = h >> 12 & 63 | 128, s[o++] = h >> 6 & 63 | 128;
      else
        continue;
      s[o++] = h & 63 | 128;
    }
    return s.slice(0, o);
  };
  function e(r = "utf-8", n = { fatal: !1 }) {
    if (r !== "utf-8")
      throw new RangeError(`Failed to construct 'TextDecoder': The encoding label provided ('${r}') is invalid.`);
    if (n.fatal)
      throw new Error("Failed to construct 'TextDecoder': the 'fatal' option is unsupported.");
  }
  Object.defineProperty(e.prototype, "encoding", {
    value: "utf-8"
  }), Object.defineProperty(e.prototype, "fatal", { value: !1 }), Object.defineProperty(e.prototype, "ignoreBOM", {
    value: !1
  }), e.prototype.decode = function(r, n = { stream: !1 }) {
    if (n.stream)
      throw new Error("Failed to decode: the 'stream' option is unsupported.");
    const a = new Uint8Array(r);
    let l = 0;
    const o = a.length, c = [];
    for (; l < o; ) {
      const s = a[l++];
      if (s === 0)
        break;
      if ((s & 128) === 0)
        c.push(s);
      else if ((s & 224) === 192) {
        const h = a[l++] & 63;
        c.push((s & 31) << 6 | h);
      } else if ((s & 240) === 224) {
        const h = a[l++] & 63, g = a[l++] & 63;
        c.push((s & 31) << 12 | h << 6 | g);
      } else if ((s & 248) === 240) {
        const h = a[l++] & 63, g = a[l++] & 63, _ = a[l++] & 63;
        let u = (s & 7) << 18 | h << 12 | g << 6 | _;
        u > 65535 && (u -= 65536, c.push(u >>> 10 & 1023 | 55296), u = 56320 | u & 1023), c.push(u);
      }
    }
    return String.fromCharCode.apply(null, c);
  }, t.TextEncoder = i, t.TextDecoder = e;
})(typeof window < "u" ? window : typeof self < "u" ? self : globalThis);
function li(t, i = "utf8") {
  return new TextDecoder(i).decode(t);
}
const vn = new TextEncoder();
function kn(t) {
  return vn.encode(t);
}
const En = 1024 * 8, Cn = (() => {
  const t = new Uint8Array(4), i = new Uint32Array(t.buffer);
  return !((i[0] = 1) & t[0]);
})(), Ct = {
  int8: globalThis.Int8Array,
  uint8: globalThis.Uint8Array,
  int16: globalThis.Int16Array,
  uint16: globalThis.Uint16Array,
  int32: globalThis.Int32Array,
  uint32: globalThis.Uint32Array,
  uint64: globalThis.BigUint64Array,
  int64: globalThis.BigInt64Array,
  float32: globalThis.Float32Array,
  float64: globalThis.Float64Array
};
class Xt {
  constructor(i = En, e = {}) {
    let r = !1;
    typeof i == "number" ? i = new ArrayBuffer(i) : (r = !0, this.lastWrittenByte = i.byteLength);
    const n = e.offset ? e.offset >>> 0 : 0, a = i.byteLength - n;
    let l = n;
    (ArrayBuffer.isView(i) || i instanceof Xt) && (i.byteLength !== i.buffer.byteLength && (l = i.byteOffset + n), i = i.buffer), r ? this.lastWrittenByte = a : this.lastWrittenByte = 0, this.buffer = i, this.length = a, this.byteLength = a, this.byteOffset = l, this.offset = 0, this.littleEndian = !0, this._data = new DataView(this.buffer, l, a), this._mark = 0, this._marks = [];
  }
  available(i = 1) {
    return this.offset + i <= this.length;
  }
  isLittleEndian() {
    return this.littleEndian;
  }
  setLittleEndian() {
    return this.littleEndian = !0, this;
  }
  isBigEndian() {
    return !this.littleEndian;
  }
  setBigEndian() {
    return this.littleEndian = !1, this;
  }
  skip(i = 1) {
    return this.offset += i, this;
  }
  back(i = 1) {
    return this.offset -= i, this;
  }
  seek(i) {
    return this.offset = i, this;
  }
  mark() {
    return this._mark = this.offset, this;
  }
  reset() {
    return this.offset = this._mark, this;
  }
  pushMark() {
    return this._marks.push(this.offset), this;
  }
  popMark() {
    const i = this._marks.pop();
    if (i === void 0)
      throw new Error("Mark stack empty");
    return this.seek(i), this;
  }
  rewind() {
    return this.offset = 0, this;
  }
  ensureAvailable(i = 1) {
    if (!this.available(i)) {
      const r = (this.offset + i) * 2, n = new Uint8Array(r);
      n.set(new Uint8Array(this.buffer)), this.buffer = n.buffer, this.length = this.byteLength = r, this._data = new DataView(this.buffer);
    }
    return this;
  }
  readBoolean() {
    return this.readUint8() !== 0;
  }
  readInt8() {
    return this._data.getInt8(this.offset++);
  }
  readUint8() {
    return this._data.getUint8(this.offset++);
  }
  readByte() {
    return this.readUint8();
  }
  readBytes(i = 1) {
    return this.readArray(i, "uint8");
  }
  readArray(i, e) {
    const r = Ct[e].BYTES_PER_ELEMENT * i, n = this.byteOffset + this.offset, a = this.buffer.slice(n, n + r);
    if (this.littleEndian === Cn && e !== "uint8" && e !== "int8") {
      const o = new Uint8Array(this.buffer.slice(n, n + r));
      o.reverse();
      const c = new Ct[e](o.buffer);
      return this.offset += r, c.reverse(), c;
    }
    const l = new Ct[e](a);
    return this.offset += r, l;
  }
  readInt16() {
    const i = this._data.getInt16(this.offset, this.littleEndian);
    return this.offset += 2, i;
  }
  readUint16() {
    const i = this._data.getUint16(this.offset, this.littleEndian);
    return this.offset += 2, i;
  }
  readInt32() {
    const i = this._data.getInt32(this.offset, this.littleEndian);
    return this.offset += 4, i;
  }
  readUint32() {
    const i = this._data.getUint32(this.offset, this.littleEndian);
    return this.offset += 4, i;
  }
  readFloat32() {
    const i = this._data.getFloat32(this.offset, this.littleEndian);
    return this.offset += 4, i;
  }
  readFloat64() {
    const i = this._data.getFloat64(this.offset, this.littleEndian);
    return this.offset += 8, i;
  }
  readBigInt64() {
    const i = this._data.getBigInt64(this.offset, this.littleEndian);
    return this.offset += 8, i;
  }
  readBigUint64() {
    const i = this._data.getBigUint64(this.offset, this.littleEndian);
    return this.offset += 8, i;
  }
  readChar() {
    return String.fromCharCode(this.readInt8());
  }
  readChars(i = 1) {
    let e = "";
    for (let r = 0; r < i; r++)
      e += this.readChar();
    return e;
  }
  readUtf8(i = 1) {
    return li(this.readBytes(i));
  }
  decodeText(i = 1, e = "utf-8") {
    return li(this.readBytes(i), e);
  }
  writeBoolean(i) {
    return this.writeUint8(i ? 255 : 0), this;
  }
  writeInt8(i) {
    return this.ensureAvailable(1), this._data.setInt8(this.offset++, i), this._updateLastWrittenByte(), this;
  }
  writeUint8(i) {
    return this.ensureAvailable(1), this._data.setUint8(this.offset++, i), this._updateLastWrittenByte(), this;
  }
  writeByte(i) {
    return this.writeUint8(i);
  }
  writeBytes(i) {
    this.ensureAvailable(i.length);
    for (let e = 0; e < i.length; e++)
      this._data.setUint8(this.offset++, i[e]);
    return this._updateLastWrittenByte(), this;
  }
  writeInt16(i) {
    return this.ensureAvailable(2), this._data.setInt16(this.offset, i, this.littleEndian), this.offset += 2, this._updateLastWrittenByte(), this;
  }
  writeUint16(i) {
    return this.ensureAvailable(2), this._data.setUint16(this.offset, i, this.littleEndian), this.offset += 2, this._updateLastWrittenByte(), this;
  }
  writeInt32(i) {
    return this.ensureAvailable(4), this._data.setInt32(this.offset, i, this.littleEndian), this.offset += 4, this._updateLastWrittenByte(), this;
  }
  writeUint32(i) {
    return this.ensureAvailable(4), this._data.setUint32(this.offset, i, this.littleEndian), this.offset += 4, this._updateLastWrittenByte(), this;
  }
  writeFloat32(i) {
    return this.ensureAvailable(4), this._data.setFloat32(this.offset, i, this.littleEndian), this.offset += 4, this._updateLastWrittenByte(), this;
  }
  writeFloat64(i) {
    return this.ensureAvailable(8), this._data.setFloat64(this.offset, i, this.littleEndian), this.offset += 8, this._updateLastWrittenByte(), this;
  }
  writeBigInt64(i) {
    return this.ensureAvailable(8), this._data.setBigInt64(this.offset, i, this.littleEndian), this.offset += 8, this._updateLastWrittenByte(), this;
  }
  writeBigUint64(i) {
    return this.ensureAvailable(8), this._data.setBigUint64(this.offset, i, this.littleEndian), this.offset += 8, this._updateLastWrittenByte(), this;
  }
  writeChar(i) {
    return this.writeUint8(i.charCodeAt(0));
  }
  writeChars(i) {
    for (let e = 0; e < i.length; e++)
      this.writeUint8(i.charCodeAt(e));
    return this;
  }
  writeUtf8(i) {
    return this.writeBytes(kn(i));
  }
  toArray() {
    return new Uint8Array(this.buffer, this.byteOffset, this.lastWrittenByte);
  }
  _updateLastWrittenByte() {
    this.offset > this.lastWrittenByte && (this.lastWrittenByte = this.offset);
  }
}
/*! pako 2.1.0 https://github.com/nodeca/pako @license (MIT AND Zlib) */
const An = 4, hi = 0, fi = 1, $n = 2;
function Ne(t) {
  let i = t.length;
  for (; --i >= 0; )
    t[i] = 0;
}
const xn = 0, br = 1, Nn = 2, Un = 3, Tn = 258, qt = 29, Je = 256, Pe = Je + 1 + qt, Ce = 30, Jt = 19, gr = 2 * Pe + 1, ue = 15, At = 16, Sn = 7, Qt = 256, wr = 16, yr = 17, mr = 18, Bt = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]), dt = new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]), Rn = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7]), vr = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]), In = 512, re = new Array((Pe + 2) * 2);
Ne(re);
const Me = new Array(Ce * 2);
Ne(Me);
const He = new Array(In);
Ne(He);
const We = new Array(Tn - Un + 1);
Ne(We);
const ei = new Array(qt);
Ne(ei);
const ut = new Array(Ce);
Ne(ut);
function $t(t, i, e, r, n) {
  this.static_tree = t, this.extra_bits = i, this.extra_base = e, this.elems = r, this.max_length = n, this.has_stree = t && t.length;
}
let kr, Er, Cr;
function xt(t, i) {
  this.dyn_tree = t, this.max_code = 0, this.stat_desc = i;
}
const Ar = (t) => t < 256 ? He[t] : He[256 + (t >>> 7)], je = (t, i) => {
  t.pending_buf[t.pending++] = i & 255, t.pending_buf[t.pending++] = i >>> 8 & 255;
}, F = (t, i, e) => {
  t.bi_valid > At - e ? (t.bi_buf |= i << t.bi_valid & 65535, je(t, t.bi_buf), t.bi_buf = i >> At - t.bi_valid, t.bi_valid += e - At) : (t.bi_buf |= i << t.bi_valid & 65535, t.bi_valid += e);
}, q = (t, i, e) => {
  F(t, e[i * 2], e[i * 2 + 1]);
}, $r = (t, i) => {
  let e = 0;
  do
    e |= t & 1, t >>>= 1, e <<= 1;
  while (--i > 0);
  return e >>> 1;
}, On = (t) => {
  t.bi_valid === 16 ? (je(t, t.bi_buf), t.bi_buf = 0, t.bi_valid = 0) : t.bi_valid >= 8 && (t.pending_buf[t.pending++] = t.bi_buf & 255, t.bi_buf >>= 8, t.bi_valid -= 8);
}, zn = (t, i) => {
  const e = i.dyn_tree, r = i.max_code, n = i.stat_desc.static_tree, a = i.stat_desc.has_stree, l = i.stat_desc.extra_bits, o = i.stat_desc.extra_base, c = i.stat_desc.max_length;
  let s, h, g, _, u, v, $ = 0;
  for (_ = 0; _ <= ue; _++)
    t.bl_count[_] = 0;
  for (e[t.heap[t.heap_max] * 2 + 1] = 0, s = t.heap_max + 1; s < gr; s++)
    h = t.heap[s], _ = e[e[h * 2 + 1] * 2 + 1] + 1, _ > c && (_ = c, $++), e[h * 2 + 1] = _, !(h > r) && (t.bl_count[_]++, u = 0, h >= o && (u = l[h - o]), v = e[h * 2], t.opt_len += v * (_ + u), a && (t.static_len += v * (n[h * 2 + 1] + u)));
  if ($ !== 0) {
    do {
      for (_ = c - 1; t.bl_count[_] === 0; )
        _--;
      t.bl_count[_]--, t.bl_count[_ + 1] += 2, t.bl_count[c]--, $ -= 2;
    } while ($ > 0);
    for (_ = c; _ !== 0; _--)
      for (h = t.bl_count[_]; h !== 0; )
        g = t.heap[--s], !(g > r) && (e[g * 2 + 1] !== _ && (t.opt_len += (_ - e[g * 2 + 1]) * e[g * 2], e[g * 2 + 1] = _), h--);
  }
}, xr = (t, i, e) => {
  const r = new Array(ue + 1);
  let n = 0, a, l;
  for (a = 1; a <= ue; a++)
    n = n + e[a - 1] << 1, r[a] = n;
  for (l = 0; l <= i; l++) {
    let o = t[l * 2 + 1];
    o !== 0 && (t[l * 2] = $r(r[o]++, o));
  }
}, Dn = () => {
  let t, i, e, r, n;
  const a = new Array(ue + 1);
  for (e = 0, r = 0; r < qt - 1; r++)
    for (ei[r] = e, t = 0; t < 1 << Bt[r]; t++)
      We[e++] = r;
  for (We[e - 1] = r, n = 0, r = 0; r < 16; r++)
    for (ut[r] = n, t = 0; t < 1 << dt[r]; t++)
      He[n++] = r;
  for (n >>= 7; r < Ce; r++)
    for (ut[r] = n << 7, t = 0; t < 1 << dt[r] - 7; t++)
      He[256 + n++] = r;
  for (i = 0; i <= ue; i++)
    a[i] = 0;
  for (t = 0; t <= 143; )
    re[t * 2 + 1] = 8, t++, a[8]++;
  for (; t <= 255; )
    re[t * 2 + 1] = 9, t++, a[9]++;
  for (; t <= 279; )
    re[t * 2 + 1] = 7, t++, a[7]++;
  for (; t <= 287; )
    re[t * 2 + 1] = 8, t++, a[8]++;
  for (xr(re, Pe + 1, a), t = 0; t < Ce; t++)
    Me[t * 2 + 1] = 5, Me[t * 2] = $r(t, 5);
  kr = new $t(re, Bt, Je + 1, Pe, ue), Er = new $t(Me, dt, 0, Ce, ue), Cr = new $t(new Array(0), Rn, 0, Jt, Sn);
}, Nr = (t) => {
  let i;
  for (i = 0; i < Pe; i++)
    t.dyn_ltree[i * 2] = 0;
  for (i = 0; i < Ce; i++)
    t.dyn_dtree[i * 2] = 0;
  for (i = 0; i < Jt; i++)
    t.bl_tree[i * 2] = 0;
  t.dyn_ltree[Qt * 2] = 1, t.opt_len = t.static_len = 0, t.sym_next = t.matches = 0;
}, Ur = (t) => {
  t.bi_valid > 8 ? je(t, t.bi_buf) : t.bi_valid > 0 && (t.pending_buf[t.pending++] = t.bi_buf), t.bi_buf = 0, t.bi_valid = 0;
}, di = (t, i, e, r) => {
  const n = i * 2, a = e * 2;
  return t[n] < t[a] || t[n] === t[a] && r[i] <= r[e];
}, Nt = (t, i, e) => {
  const r = t.heap[e];
  let n = e << 1;
  for (; n <= t.heap_len && (n < t.heap_len && di(i, t.heap[n + 1], t.heap[n], t.depth) && n++, !di(i, r, t.heap[n], t.depth)); )
    t.heap[e] = t.heap[n], e = n, n <<= 1;
  t.heap[e] = r;
}, ui = (t, i, e) => {
  let r, n, a = 0, l, o;
  if (t.sym_next !== 0)
    do
      r = t.pending_buf[t.sym_buf + a++] & 255, r += (t.pending_buf[t.sym_buf + a++] & 255) << 8, n = t.pending_buf[t.sym_buf + a++], r === 0 ? q(t, n, i) : (l = We[n], q(t, l + Je + 1, i), o = Bt[l], o !== 0 && (n -= ei[l], F(t, n, o)), r--, l = Ar(r), q(t, l, e), o = dt[l], o !== 0 && (r -= ut[l], F(t, r, o)));
    while (a < t.sym_next);
  q(t, Qt, i);
}, Ft = (t, i) => {
  const e = i.dyn_tree, r = i.stat_desc.static_tree, n = i.stat_desc.has_stree, a = i.stat_desc.elems;
  let l, o, c = -1, s;
  for (t.heap_len = 0, t.heap_max = gr, l = 0; l < a; l++)
    e[l * 2] !== 0 ? (t.heap[++t.heap_len] = c = l, t.depth[l] = 0) : e[l * 2 + 1] = 0;
  for (; t.heap_len < 2; )
    s = t.heap[++t.heap_len] = c < 2 ? ++c : 0, e[s * 2] = 1, t.depth[s] = 0, t.opt_len--, n && (t.static_len -= r[s * 2 + 1]);
  for (i.max_code = c, l = t.heap_len >> 1; l >= 1; l--)
    Nt(t, e, l);
  s = a;
  do
    l = t.heap[1], t.heap[1] = t.heap[t.heap_len--], Nt(t, e, 1), o = t.heap[1], t.heap[--t.heap_max] = l, t.heap[--t.heap_max] = o, e[s * 2] = e[l * 2] + e[o * 2], t.depth[s] = (t.depth[l] >= t.depth[o] ? t.depth[l] : t.depth[o]) + 1, e[l * 2 + 1] = e[o * 2 + 1] = s, t.heap[1] = s++, Nt(t, e, 1);
  while (t.heap_len >= 2);
  t.heap[--t.heap_max] = t.heap[1], zn(t, i), xr(e, c, t.bl_count);
}, ci = (t, i, e) => {
  let r, n = -1, a, l = i[0 * 2 + 1], o = 0, c = 7, s = 4;
  for (l === 0 && (c = 138, s = 3), i[(e + 1) * 2 + 1] = 65535, r = 0; r <= e; r++)
    a = l, l = i[(r + 1) * 2 + 1], !(++o < c && a === l) && (o < s ? t.bl_tree[a * 2] += o : a !== 0 ? (a !== n && t.bl_tree[a * 2]++, t.bl_tree[wr * 2]++) : o <= 10 ? t.bl_tree[yr * 2]++ : t.bl_tree[mr * 2]++, o = 0, n = a, l === 0 ? (c = 138, s = 3) : a === l ? (c = 6, s = 3) : (c = 7, s = 4));
}, pi = (t, i, e) => {
  let r, n = -1, a, l = i[0 * 2 + 1], o = 0, c = 7, s = 4;
  for (l === 0 && (c = 138, s = 3), r = 0; r <= e; r++)
    if (a = l, l = i[(r + 1) * 2 + 1], !(++o < c && a === l)) {
      if (o < s)
        do
          q(t, a, t.bl_tree);
        while (--o !== 0);
      else
        a !== 0 ? (a !== n && (q(t, a, t.bl_tree), o--), q(t, wr, t.bl_tree), F(t, o - 3, 2)) : o <= 10 ? (q(t, yr, t.bl_tree), F(t, o - 3, 3)) : (q(t, mr, t.bl_tree), F(t, o - 11, 7));
      o = 0, n = a, l === 0 ? (c = 138, s = 3) : a === l ? (c = 6, s = 3) : (c = 7, s = 4);
    }
}, Ln = (t) => {
  let i;
  for (ci(t, t.dyn_ltree, t.l_desc.max_code), ci(t, t.dyn_dtree, t.d_desc.max_code), Ft(t, t.bl_desc), i = Jt - 1; i >= 3 && t.bl_tree[vr[i] * 2 + 1] === 0; i--)
    ;
  return t.opt_len += 3 * (i + 1) + 5 + 5 + 4, i;
}, Vn = (t, i, e, r) => {
  let n;
  for (F(t, i - 257, 5), F(t, e - 1, 5), F(t, r - 4, 4), n = 0; n < r; n++)
    F(t, t.bl_tree[vr[n] * 2 + 1], 3);
  pi(t, t.dyn_ltree, i - 1), pi(t, t.dyn_dtree, e - 1);
}, Mn = (t) => {
  let i = 4093624447, e;
  for (e = 0; e <= 31; e++, i >>>= 1)
    if (i & 1 && t.dyn_ltree[e * 2] !== 0)
      return hi;
  if (t.dyn_ltree[9 * 2] !== 0 || t.dyn_ltree[10 * 2] !== 0 || t.dyn_ltree[13 * 2] !== 0)
    return fi;
  for (e = 32; e < Je; e++)
    if (t.dyn_ltree[e * 2] !== 0)
      return fi;
  return hi;
};
let _i = !1;
const Bn = (t) => {
  _i || (Dn(), _i = !0), t.l_desc = new xt(t.dyn_ltree, kr), t.d_desc = new xt(t.dyn_dtree, Er), t.bl_desc = new xt(t.bl_tree, Cr), t.bi_buf = 0, t.bi_valid = 0, Nr(t);
}, Tr = (t, i, e, r) => {
  F(t, (xn << 1) + (r ? 1 : 0), 3), Ur(t), je(t, e), je(t, ~e), e && t.pending_buf.set(t.window.subarray(i, i + e), t.pending), t.pending += e;
}, Fn = (t) => {
  F(t, br << 1, 3), q(t, Qt, re), On(t);
}, Zn = (t, i, e, r) => {
  let n, a, l = 0;
  t.level > 0 ? (t.strm.data_type === $n && (t.strm.data_type = Mn(t)), Ft(t, t.l_desc), Ft(t, t.d_desc), l = Ln(t), n = t.opt_len + 3 + 7 >>> 3, a = t.static_len + 3 + 7 >>> 3, a <= n && (n = a)) : n = a = e + 5, e + 4 <= n && i !== -1 ? Tr(t, i, e, r) : t.strategy === An || a === n ? (F(t, (br << 1) + (r ? 1 : 0), 3), ui(t, re, Me)) : (F(t, (Nn << 1) + (r ? 1 : 0), 3), Vn(t, t.l_desc.max_code + 1, t.d_desc.max_code + 1, l + 1), ui(t, t.dyn_ltree, t.dyn_dtree)), Nr(t), r && Ur(t);
}, Pn = (t, i, e) => (t.pending_buf[t.sym_buf + t.sym_next++] = i, t.pending_buf[t.sym_buf + t.sym_next++] = i >> 8, t.pending_buf[t.sym_buf + t.sym_next++] = e, i === 0 ? t.dyn_ltree[e * 2]++ : (t.matches++, i--, t.dyn_ltree[(We[e] + Je + 1) * 2]++, t.dyn_dtree[Ar(i) * 2]++), t.sym_next === t.sym_end);
var Hn = Bn, Wn = Tr, jn = Zn, Kn = Pn, Gn = Fn, Yn = {
  _tr_init: Hn,
  _tr_stored_block: Wn,
  _tr_flush_block: jn,
  _tr_tally: Kn,
  _tr_align: Gn
};
const Xn = (t, i, e, r) => {
  let n = t & 65535 | 0, a = t >>> 16 & 65535 | 0, l = 0;
  for (; e !== 0; ) {
    l = e > 2e3 ? 2e3 : e, e -= l;
    do
      n = n + i[r++] | 0, a = a + n | 0;
    while (--l);
    n %= 65521, a %= 65521;
  }
  return n | a << 16 | 0;
};
var Ke = Xn;
const qn = () => {
  let t, i = [];
  for (var e = 0; e < 256; e++) {
    t = e;
    for (var r = 0; r < 8; r++)
      t = t & 1 ? 3988292384 ^ t >>> 1 : t >>> 1;
    i[e] = t;
  }
  return i;
}, Jn = new Uint32Array(qn()), Qn = (t, i, e, r) => {
  const n = Jn, a = r + e;
  t ^= -1;
  for (let l = r; l < a; l++)
    t = t >>> 8 ^ n[(t ^ i[l]) & 255];
  return t ^ -1;
};
var z = Qn, Ae = {
  2: "need dictionary",
  1: "stream end",
  0: "",
  "-1": "file error",
  "-2": "stream error",
  "-3": "data error",
  "-4": "insufficient memory",
  "-5": "buffer error",
  "-6": "incompatible version"
}, Qe = {
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_TREES: 6,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  Z_BINARY: 0,
  Z_TEXT: 1,
  Z_UNKNOWN: 2,
  Z_DEFLATED: 8
};
const { _tr_init: ea, _tr_stored_block: Zt, _tr_flush_block: ta, _tr_tally: oe, _tr_align: ia } = Yn, {
  Z_NO_FLUSH: le,
  Z_PARTIAL_FLUSH: ra,
  Z_FULL_FLUSH: na,
  Z_FINISH: j,
  Z_BLOCK: bi,
  Z_OK: D,
  Z_STREAM_END: gi,
  Z_STREAM_ERROR: J,
  Z_DATA_ERROR: aa,
  Z_BUF_ERROR: Ut,
  Z_DEFAULT_COMPRESSION: sa,
  Z_FILTERED: oa,
  Z_HUFFMAN_ONLY: st,
  Z_RLE: la,
  Z_FIXED: ha,
  Z_DEFAULT_STRATEGY: fa,
  Z_UNKNOWN: da,
  Z_DEFLATED: gt
} = Qe, ua = 9, ca = 15, pa = 8, _a = 29, ba = 256, Pt = ba + 1 + _a, ga = 30, wa = 19, ya = 2 * Pt + 1, ma = 15, U = 3, se = 258, Q = se + U + 1, va = 32, $e = 42, ti = 57, Ht = 69, Wt = 73, jt = 91, Kt = 103, ce = 113, Le = 666, V = 1, Ue = 2, _e = 3, Te = 4, ka = 3, pe = (t, i) => (t.msg = Ae[i], i), wi = (t) => t * 2 - (t > 4 ? 9 : 0), ae = (t) => {
  let i = t.length;
  for (; --i >= 0; )
    t[i] = 0;
}, Ea = (t) => {
  let i, e, r, n = t.w_size;
  i = t.hash_size, r = i;
  do
    e = t.head[--r], t.head[r] = e >= n ? e - n : 0;
  while (--i);
  i = n, r = i;
  do
    e = t.prev[--r], t.prev[r] = e >= n ? e - n : 0;
  while (--i);
};
let Ca = (t, i, e) => (i << t.hash_shift ^ e) & t.hash_mask, he = Ca;
const P = (t) => {
  const i = t.state;
  let e = i.pending;
  e > t.avail_out && (e = t.avail_out), e !== 0 && (t.output.set(i.pending_buf.subarray(i.pending_out, i.pending_out + e), t.next_out), t.next_out += e, i.pending_out += e, t.total_out += e, t.avail_out -= e, i.pending -= e, i.pending === 0 && (i.pending_out = 0));
}, H = (t, i) => {
  ta(t, t.block_start >= 0 ? t.block_start : -1, t.strstart - t.block_start, i), t.block_start = t.strstart, P(t.strm);
}, R = (t, i) => {
  t.pending_buf[t.pending++] = i;
}, Ie = (t, i) => {
  t.pending_buf[t.pending++] = i >>> 8 & 255, t.pending_buf[t.pending++] = i & 255;
}, Gt = (t, i, e, r) => {
  let n = t.avail_in;
  return n > r && (n = r), n === 0 ? 0 : (t.avail_in -= n, i.set(t.input.subarray(t.next_in, t.next_in + n), e), t.state.wrap === 1 ? t.adler = Ke(t.adler, i, n, e) : t.state.wrap === 2 && (t.adler = z(t.adler, i, n, e)), t.next_in += n, t.total_in += n, n);
}, Sr = (t, i) => {
  let e = t.max_chain_length, r = t.strstart, n, a, l = t.prev_length, o = t.nice_match;
  const c = t.strstart > t.w_size - Q ? t.strstart - (t.w_size - Q) : 0, s = t.window, h = t.w_mask, g = t.prev, _ = t.strstart + se;
  let u = s[r + l - 1], v = s[r + l];
  t.prev_length >= t.good_match && (e >>= 2), o > t.lookahead && (o = t.lookahead);
  do
    if (n = i, !(s[n + l] !== v || s[n + l - 1] !== u || s[n] !== s[r] || s[++n] !== s[r + 1])) {
      r += 2, n++;
      do
        ;
      while (s[++r] === s[++n] && s[++r] === s[++n] && s[++r] === s[++n] && s[++r] === s[++n] && s[++r] === s[++n] && s[++r] === s[++n] && s[++r] === s[++n] && s[++r] === s[++n] && r < _);
      if (a = se - (_ - r), r = _ - se, a > l) {
        if (t.match_start = i, l = a, a >= o)
          break;
        u = s[r + l - 1], v = s[r + l];
      }
    }
  while ((i = g[i & h]) > c && --e !== 0);
  return l <= t.lookahead ? l : t.lookahead;
}, xe = (t) => {
  const i = t.w_size;
  let e, r, n;
  do {
    if (r = t.window_size - t.lookahead - t.strstart, t.strstart >= i + (i - Q) && (t.window.set(t.window.subarray(i, i + i - r), 0), t.match_start -= i, t.strstart -= i, t.block_start -= i, t.insert > t.strstart && (t.insert = t.strstart), Ea(t), r += i), t.strm.avail_in === 0)
      break;
    if (e = Gt(t.strm, t.window, t.strstart + t.lookahead, r), t.lookahead += e, t.lookahead + t.insert >= U)
      for (n = t.strstart - t.insert, t.ins_h = t.window[n], t.ins_h = he(t, t.ins_h, t.window[n + 1]); t.insert && (t.ins_h = he(t, t.ins_h, t.window[n + U - 1]), t.prev[n & t.w_mask] = t.head[t.ins_h], t.head[t.ins_h] = n, n++, t.insert--, !(t.lookahead + t.insert < U)); )
        ;
  } while (t.lookahead < Q && t.strm.avail_in !== 0);
}, Rr = (t, i) => {
  let e = t.pending_buf_size - 5 > t.w_size ? t.w_size : t.pending_buf_size - 5, r, n, a, l = 0, o = t.strm.avail_in;
  do {
    if (r = 65535, a = t.bi_valid + 42 >> 3, t.strm.avail_out < a || (a = t.strm.avail_out - a, n = t.strstart - t.block_start, r > n + t.strm.avail_in && (r = n + t.strm.avail_in), r > a && (r = a), r < e && (r === 0 && i !== j || i === le || r !== n + t.strm.avail_in)))
      break;
    l = i === j && r === n + t.strm.avail_in ? 1 : 0, Zt(t, 0, 0, l), t.pending_buf[t.pending - 4] = r, t.pending_buf[t.pending - 3] = r >> 8, t.pending_buf[t.pending - 2] = ~r, t.pending_buf[t.pending - 1] = ~r >> 8, P(t.strm), n && (n > r && (n = r), t.strm.output.set(t.window.subarray(t.block_start, t.block_start + n), t.strm.next_out), t.strm.next_out += n, t.strm.avail_out -= n, t.strm.total_out += n, t.block_start += n, r -= n), r && (Gt(t.strm, t.strm.output, t.strm.next_out, r), t.strm.next_out += r, t.strm.avail_out -= r, t.strm.total_out += r);
  } while (l === 0);
  return o -= t.strm.avail_in, o && (o >= t.w_size ? (t.matches = 2, t.window.set(t.strm.input.subarray(t.strm.next_in - t.w_size, t.strm.next_in), 0), t.strstart = t.w_size, t.insert = t.strstart) : (t.window_size - t.strstart <= o && (t.strstart -= t.w_size, t.window.set(t.window.subarray(t.w_size, t.w_size + t.strstart), 0), t.matches < 2 && t.matches++, t.insert > t.strstart && (t.insert = t.strstart)), t.window.set(t.strm.input.subarray(t.strm.next_in - o, t.strm.next_in), t.strstart), t.strstart += o, t.insert += o > t.w_size - t.insert ? t.w_size - t.insert : o), t.block_start = t.strstart), t.high_water < t.strstart && (t.high_water = t.strstart), l ? Te : i !== le && i !== j && t.strm.avail_in === 0 && t.strstart === t.block_start ? Ue : (a = t.window_size - t.strstart, t.strm.avail_in > a && t.block_start >= t.w_size && (t.block_start -= t.w_size, t.strstart -= t.w_size, t.window.set(t.window.subarray(t.w_size, t.w_size + t.strstart), 0), t.matches < 2 && t.matches++, a += t.w_size, t.insert > t.strstart && (t.insert = t.strstart)), a > t.strm.avail_in && (a = t.strm.avail_in), a && (Gt(t.strm, t.window, t.strstart, a), t.strstart += a, t.insert += a > t.w_size - t.insert ? t.w_size - t.insert : a), t.high_water < t.strstart && (t.high_water = t.strstart), a = t.bi_valid + 42 >> 3, a = t.pending_buf_size - a > 65535 ? 65535 : t.pending_buf_size - a, e = a > t.w_size ? t.w_size : a, n = t.strstart - t.block_start, (n >= e || (n || i === j) && i !== le && t.strm.avail_in === 0 && n <= a) && (r = n > a ? a : n, l = i === j && t.strm.avail_in === 0 && r === n ? 1 : 0, Zt(t, t.block_start, r, l), t.block_start += r, P(t.strm)), l ? _e : V);
}, Tt = (t, i) => {
  let e, r;
  for (; ; ) {
    if (t.lookahead < Q) {
      if (xe(t), t.lookahead < Q && i === le)
        return V;
      if (t.lookahead === 0)
        break;
    }
    if (e = 0, t.lookahead >= U && (t.ins_h = he(t, t.ins_h, t.window[t.strstart + U - 1]), e = t.prev[t.strstart & t.w_mask] = t.head[t.ins_h], t.head[t.ins_h] = t.strstart), e !== 0 && t.strstart - e <= t.w_size - Q && (t.match_length = Sr(t, e)), t.match_length >= U)
      if (r = oe(t, t.strstart - t.match_start, t.match_length - U), t.lookahead -= t.match_length, t.match_length <= t.max_lazy_match && t.lookahead >= U) {
        t.match_length--;
        do
          t.strstart++, t.ins_h = he(t, t.ins_h, t.window[t.strstart + U - 1]), e = t.prev[t.strstart & t.w_mask] = t.head[t.ins_h], t.head[t.ins_h] = t.strstart;
        while (--t.match_length !== 0);
        t.strstart++;
      } else
        t.strstart += t.match_length, t.match_length = 0, t.ins_h = t.window[t.strstart], t.ins_h = he(t, t.ins_h, t.window[t.strstart + 1]);
    else
      r = oe(t, 0, t.window[t.strstart]), t.lookahead--, t.strstart++;
    if (r && (H(t, !1), t.strm.avail_out === 0))
      return V;
  }
  return t.insert = t.strstart < U - 1 ? t.strstart : U - 1, i === j ? (H(t, !0), t.strm.avail_out === 0 ? _e : Te) : t.sym_next && (H(t, !1), t.strm.avail_out === 0) ? V : Ue;
}, me = (t, i) => {
  let e, r, n;
  for (; ; ) {
    if (t.lookahead < Q) {
      if (xe(t), t.lookahead < Q && i === le)
        return V;
      if (t.lookahead === 0)
        break;
    }
    if (e = 0, t.lookahead >= U && (t.ins_h = he(t, t.ins_h, t.window[t.strstart + U - 1]), e = t.prev[t.strstart & t.w_mask] = t.head[t.ins_h], t.head[t.ins_h] = t.strstart), t.prev_length = t.match_length, t.prev_match = t.match_start, t.match_length = U - 1, e !== 0 && t.prev_length < t.max_lazy_match && t.strstart - e <= t.w_size - Q && (t.match_length = Sr(t, e), t.match_length <= 5 && (t.strategy === oa || t.match_length === U && t.strstart - t.match_start > 4096) && (t.match_length = U - 1)), t.prev_length >= U && t.match_length <= t.prev_length) {
      n = t.strstart + t.lookahead - U, r = oe(t, t.strstart - 1 - t.prev_match, t.prev_length - U), t.lookahead -= t.prev_length - 1, t.prev_length -= 2;
      do
        ++t.strstart <= n && (t.ins_h = he(t, t.ins_h, t.window[t.strstart + U - 1]), e = t.prev[t.strstart & t.w_mask] = t.head[t.ins_h], t.head[t.ins_h] = t.strstart);
      while (--t.prev_length !== 0);
      if (t.match_available = 0, t.match_length = U - 1, t.strstart++, r && (H(t, !1), t.strm.avail_out === 0))
        return V;
    } else if (t.match_available) {
      if (r = oe(t, 0, t.window[t.strstart - 1]), r && H(t, !1), t.strstart++, t.lookahead--, t.strm.avail_out === 0)
        return V;
    } else
      t.match_available = 1, t.strstart++, t.lookahead--;
  }
  return t.match_available && (r = oe(t, 0, t.window[t.strstart - 1]), t.match_available = 0), t.insert = t.strstart < U - 1 ? t.strstart : U - 1, i === j ? (H(t, !0), t.strm.avail_out === 0 ? _e : Te) : t.sym_next && (H(t, !1), t.strm.avail_out === 0) ? V : Ue;
}, Aa = (t, i) => {
  let e, r, n, a;
  const l = t.window;
  for (; ; ) {
    if (t.lookahead <= se) {
      if (xe(t), t.lookahead <= se && i === le)
        return V;
      if (t.lookahead === 0)
        break;
    }
    if (t.match_length = 0, t.lookahead >= U && t.strstart > 0 && (n = t.strstart - 1, r = l[n], r === l[++n] && r === l[++n] && r === l[++n])) {
      a = t.strstart + se;
      do
        ;
      while (r === l[++n] && r === l[++n] && r === l[++n] && r === l[++n] && r === l[++n] && r === l[++n] && r === l[++n] && r === l[++n] && n < a);
      t.match_length = se - (a - n), t.match_length > t.lookahead && (t.match_length = t.lookahead);
    }
    if (t.match_length >= U ? (e = oe(t, 1, t.match_length - U), t.lookahead -= t.match_length, t.strstart += t.match_length, t.match_length = 0) : (e = oe(t, 0, t.window[t.strstart]), t.lookahead--, t.strstart++), e && (H(t, !1), t.strm.avail_out === 0))
      return V;
  }
  return t.insert = 0, i === j ? (H(t, !0), t.strm.avail_out === 0 ? _e : Te) : t.sym_next && (H(t, !1), t.strm.avail_out === 0) ? V : Ue;
}, $a = (t, i) => {
  let e;
  for (; ; ) {
    if (t.lookahead === 0 && (xe(t), t.lookahead === 0)) {
      if (i === le)
        return V;
      break;
    }
    if (t.match_length = 0, e = oe(t, 0, t.window[t.strstart]), t.lookahead--, t.strstart++, e && (H(t, !1), t.strm.avail_out === 0))
      return V;
  }
  return t.insert = 0, i === j ? (H(t, !0), t.strm.avail_out === 0 ? _e : Te) : t.sym_next && (H(t, !1), t.strm.avail_out === 0) ? V : Ue;
};
function X(t, i, e, r, n) {
  this.good_length = t, this.max_lazy = i, this.nice_length = e, this.max_chain = r, this.func = n;
}
const Ve = [
  new X(0, 0, 0, 0, Rr),
  new X(4, 4, 8, 4, Tt),
  new X(4, 5, 16, 8, Tt),
  new X(4, 6, 32, 32, Tt),
  new X(4, 4, 16, 16, me),
  new X(8, 16, 32, 32, me),
  new X(8, 16, 128, 128, me),
  new X(8, 32, 128, 256, me),
  new X(32, 128, 258, 1024, me),
  new X(32, 258, 258, 4096, me)
], xa = (t) => {
  t.window_size = 2 * t.w_size, ae(t.head), t.max_lazy_match = Ve[t.level].max_lazy, t.good_match = Ve[t.level].good_length, t.nice_match = Ve[t.level].nice_length, t.max_chain_length = Ve[t.level].max_chain, t.strstart = 0, t.block_start = 0, t.lookahead = 0, t.insert = 0, t.match_length = t.prev_length = U - 1, t.match_available = 0, t.ins_h = 0;
};
function Na() {
  this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = gt, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new Uint16Array(ya * 2), this.dyn_dtree = new Uint16Array((2 * ga + 1) * 2), this.bl_tree = new Uint16Array((2 * wa + 1) * 2), ae(this.dyn_ltree), ae(this.dyn_dtree), ae(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new Uint16Array(ma + 1), this.heap = new Uint16Array(2 * Pt + 1), ae(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new Uint16Array(2 * Pt + 1), ae(this.depth), this.sym_buf = 0, this.lit_bufsize = 0, this.sym_next = 0, this.sym_end = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
}
const et = (t) => {
  if (!t)
    return 1;
  const i = t.state;
  return !i || i.strm !== t || i.status !== $e && i.status !== ti && i.status !== Ht && i.status !== Wt && i.status !== jt && i.status !== Kt && i.status !== ce && i.status !== Le ? 1 : 0;
}, Ir = (t) => {
  if (et(t))
    return pe(t, J);
  t.total_in = t.total_out = 0, t.data_type = da;
  const i = t.state;
  return i.pending = 0, i.pending_out = 0, i.wrap < 0 && (i.wrap = -i.wrap), i.status = i.wrap === 2 ? ti : i.wrap ? $e : ce, t.adler = i.wrap === 2 ? 0 : 1, i.last_flush = -2, ea(i), D;
}, Or = (t) => {
  const i = Ir(t);
  return i === D && xa(t.state), i;
}, Ua = (t, i) => et(t) || t.state.wrap !== 2 ? J : (t.state.gzhead = i, D), zr = (t, i, e, r, n, a) => {
  if (!t)
    return J;
  let l = 1;
  if (i === sa && (i = 6), r < 0 ? (l = 0, r = -r) : r > 15 && (l = 2, r -= 16), n < 1 || n > ua || e !== gt || r < 8 || r > 15 || i < 0 || i > 9 || a < 0 || a > ha || r === 8 && l !== 1)
    return pe(t, J);
  r === 8 && (r = 9);
  const o = new Na();
  return t.state = o, o.strm = t, o.status = $e, o.wrap = l, o.gzhead = null, o.w_bits = r, o.w_size = 1 << o.w_bits, o.w_mask = o.w_size - 1, o.hash_bits = n + 7, o.hash_size = 1 << o.hash_bits, o.hash_mask = o.hash_size - 1, o.hash_shift = ~~((o.hash_bits + U - 1) / U), o.window = new Uint8Array(o.w_size * 2), o.head = new Uint16Array(o.hash_size), o.prev = new Uint16Array(o.w_size), o.lit_bufsize = 1 << n + 6, o.pending_buf_size = o.lit_bufsize * 4, o.pending_buf = new Uint8Array(o.pending_buf_size), o.sym_buf = o.lit_bufsize, o.sym_end = (o.lit_bufsize - 1) * 3, o.level = i, o.strategy = a, o.method = e, Or(t);
}, Ta = (t, i) => zr(t, i, gt, ca, pa, fa), Sa = (t, i) => {
  if (et(t) || i > bi || i < 0)
    return t ? pe(t, J) : J;
  const e = t.state;
  if (!t.output || t.avail_in !== 0 && !t.input || e.status === Le && i !== j)
    return pe(t, t.avail_out === 0 ? Ut : J);
  const r = e.last_flush;
  if (e.last_flush = i, e.pending !== 0) {
    if (P(t), t.avail_out === 0)
      return e.last_flush = -1, D;
  } else if (t.avail_in === 0 && wi(i) <= wi(r) && i !== j)
    return pe(t, Ut);
  if (e.status === Le && t.avail_in !== 0)
    return pe(t, Ut);
  if (e.status === $e && e.wrap === 0 && (e.status = ce), e.status === $e) {
    let n = gt + (e.w_bits - 8 << 4) << 8, a = -1;
    if (e.strategy >= st || e.level < 2 ? a = 0 : e.level < 6 ? a = 1 : e.level === 6 ? a = 2 : a = 3, n |= a << 6, e.strstart !== 0 && (n |= va), n += 31 - n % 31, Ie(e, n), e.strstart !== 0 && (Ie(e, t.adler >>> 16), Ie(e, t.adler & 65535)), t.adler = 1, e.status = ce, P(t), e.pending !== 0)
      return e.last_flush = -1, D;
  }
  if (e.status === ti) {
    if (t.adler = 0, R(e, 31), R(e, 139), R(e, 8), e.gzhead)
      R(
        e,
        (e.gzhead.text ? 1 : 0) + (e.gzhead.hcrc ? 2 : 0) + (e.gzhead.extra ? 4 : 0) + (e.gzhead.name ? 8 : 0) + (e.gzhead.comment ? 16 : 0)
      ), R(e, e.gzhead.time & 255), R(e, e.gzhead.time >> 8 & 255), R(e, e.gzhead.time >> 16 & 255), R(e, e.gzhead.time >> 24 & 255), R(e, e.level === 9 ? 2 : e.strategy >= st || e.level < 2 ? 4 : 0), R(e, e.gzhead.os & 255), e.gzhead.extra && e.gzhead.extra.length && (R(e, e.gzhead.extra.length & 255), R(e, e.gzhead.extra.length >> 8 & 255)), e.gzhead.hcrc && (t.adler = z(t.adler, e.pending_buf, e.pending, 0)), e.gzindex = 0, e.status = Ht;
    else if (R(e, 0), R(e, 0), R(e, 0), R(e, 0), R(e, 0), R(e, e.level === 9 ? 2 : e.strategy >= st || e.level < 2 ? 4 : 0), R(e, ka), e.status = ce, P(t), e.pending !== 0)
      return e.last_flush = -1, D;
  }
  if (e.status === Ht) {
    if (e.gzhead.extra) {
      let n = e.pending, a = (e.gzhead.extra.length & 65535) - e.gzindex;
      for (; e.pending + a > e.pending_buf_size; ) {
        let o = e.pending_buf_size - e.pending;
        if (e.pending_buf.set(e.gzhead.extra.subarray(e.gzindex, e.gzindex + o), e.pending), e.pending = e.pending_buf_size, e.gzhead.hcrc && e.pending > n && (t.adler = z(t.adler, e.pending_buf, e.pending - n, n)), e.gzindex += o, P(t), e.pending !== 0)
          return e.last_flush = -1, D;
        n = 0, a -= o;
      }
      let l = new Uint8Array(e.gzhead.extra);
      e.pending_buf.set(l.subarray(e.gzindex, e.gzindex + a), e.pending), e.pending += a, e.gzhead.hcrc && e.pending > n && (t.adler = z(t.adler, e.pending_buf, e.pending - n, n)), e.gzindex = 0;
    }
    e.status = Wt;
  }
  if (e.status === Wt) {
    if (e.gzhead.name) {
      let n = e.pending, a;
      do {
        if (e.pending === e.pending_buf_size) {
          if (e.gzhead.hcrc && e.pending > n && (t.adler = z(t.adler, e.pending_buf, e.pending - n, n)), P(t), e.pending !== 0)
            return e.last_flush = -1, D;
          n = 0;
        }
        e.gzindex < e.gzhead.name.length ? a = e.gzhead.name.charCodeAt(e.gzindex++) & 255 : a = 0, R(e, a);
      } while (a !== 0);
      e.gzhead.hcrc && e.pending > n && (t.adler = z(t.adler, e.pending_buf, e.pending - n, n)), e.gzindex = 0;
    }
    e.status = jt;
  }
  if (e.status === jt) {
    if (e.gzhead.comment) {
      let n = e.pending, a;
      do {
        if (e.pending === e.pending_buf_size) {
          if (e.gzhead.hcrc && e.pending > n && (t.adler = z(t.adler, e.pending_buf, e.pending - n, n)), P(t), e.pending !== 0)
            return e.last_flush = -1, D;
          n = 0;
        }
        e.gzindex < e.gzhead.comment.length ? a = e.gzhead.comment.charCodeAt(e.gzindex++) & 255 : a = 0, R(e, a);
      } while (a !== 0);
      e.gzhead.hcrc && e.pending > n && (t.adler = z(t.adler, e.pending_buf, e.pending - n, n));
    }
    e.status = Kt;
  }
  if (e.status === Kt) {
    if (e.gzhead.hcrc) {
      if (e.pending + 2 > e.pending_buf_size && (P(t), e.pending !== 0))
        return e.last_flush = -1, D;
      R(e, t.adler & 255), R(e, t.adler >> 8 & 255), t.adler = 0;
    }
    if (e.status = ce, P(t), e.pending !== 0)
      return e.last_flush = -1, D;
  }
  if (t.avail_in !== 0 || e.lookahead !== 0 || i !== le && e.status !== Le) {
    let n = e.level === 0 ? Rr(e, i) : e.strategy === st ? $a(e, i) : e.strategy === la ? Aa(e, i) : Ve[e.level].func(e, i);
    if ((n === _e || n === Te) && (e.status = Le), n === V || n === _e)
      return t.avail_out === 0 && (e.last_flush = -1), D;
    if (n === Ue && (i === ra ? ia(e) : i !== bi && (Zt(e, 0, 0, !1), i === na && (ae(e.head), e.lookahead === 0 && (e.strstart = 0, e.block_start = 0, e.insert = 0))), P(t), t.avail_out === 0))
      return e.last_flush = -1, D;
  }
  return i !== j ? D : e.wrap <= 0 ? gi : (e.wrap === 2 ? (R(e, t.adler & 255), R(e, t.adler >> 8 & 255), R(e, t.adler >> 16 & 255), R(e, t.adler >> 24 & 255), R(e, t.total_in & 255), R(e, t.total_in >> 8 & 255), R(e, t.total_in >> 16 & 255), R(e, t.total_in >> 24 & 255)) : (Ie(e, t.adler >>> 16), Ie(e, t.adler & 65535)), P(t), e.wrap > 0 && (e.wrap = -e.wrap), e.pending !== 0 ? D : gi);
}, Ra = (t) => {
  if (et(t))
    return J;
  const i = t.state.status;
  return t.state = null, i === ce ? pe(t, aa) : D;
}, Ia = (t, i) => {
  let e = i.length;
  if (et(t))
    return J;
  const r = t.state, n = r.wrap;
  if (n === 2 || n === 1 && r.status !== $e || r.lookahead)
    return J;
  if (n === 1 && (t.adler = Ke(t.adler, i, e, 0)), r.wrap = 0, e >= r.w_size) {
    n === 0 && (ae(r.head), r.strstart = 0, r.block_start = 0, r.insert = 0);
    let c = new Uint8Array(r.w_size);
    c.set(i.subarray(e - r.w_size, e), 0), i = c, e = r.w_size;
  }
  const a = t.avail_in, l = t.next_in, o = t.input;
  for (t.avail_in = e, t.next_in = 0, t.input = i, xe(r); r.lookahead >= U; ) {
    let c = r.strstart, s = r.lookahead - (U - 1);
    do
      r.ins_h = he(r, r.ins_h, r.window[c + U - 1]), r.prev[c & r.w_mask] = r.head[r.ins_h], r.head[r.ins_h] = c, c++;
    while (--s);
    r.strstart = c, r.lookahead = U - 1, xe(r);
  }
  return r.strstart += r.lookahead, r.block_start = r.strstart, r.insert = r.lookahead, r.lookahead = 0, r.match_length = r.prev_length = U - 1, r.match_available = 0, t.next_in = l, t.input = o, t.avail_in = a, r.wrap = n, D;
};
var Oa = Ta, za = zr, Da = Or, La = Ir, Va = Ua, Ma = Sa, Ba = Ra, Fa = Ia, Za = "pako deflate (from Nodeca project)", Be = {
  deflateInit: Oa,
  deflateInit2: za,
  deflateReset: Da,
  deflateResetKeep: La,
  deflateSetHeader: Va,
  deflate: Ma,
  deflateEnd: Ba,
  deflateSetDictionary: Fa,
  deflateInfo: Za
};
const Pa = (t, i) => Object.prototype.hasOwnProperty.call(t, i);
var Ha = function(t) {
  const i = Array.prototype.slice.call(arguments, 1);
  for (; i.length; ) {
    const e = i.shift();
    if (!!e) {
      if (typeof e != "object")
        throw new TypeError(e + "must be non-object");
      for (const r in e)
        Pa(e, r) && (t[r] = e[r]);
    }
  }
  return t;
}, Wa = (t) => {
  let i = 0;
  for (let r = 0, n = t.length; r < n; r++)
    i += t[r].length;
  const e = new Uint8Array(i);
  for (let r = 0, n = 0, a = t.length; r < a; r++) {
    let l = t[r];
    e.set(l, n), n += l.length;
  }
  return e;
}, wt = {
  assign: Ha,
  flattenChunks: Wa
};
let Dr = !0;
try {
  String.fromCharCode.apply(null, new Uint8Array(1));
} catch {
  Dr = !1;
}
const Ge = new Uint8Array(256);
for (let t = 0; t < 256; t++)
  Ge[t] = t >= 252 ? 6 : t >= 248 ? 5 : t >= 240 ? 4 : t >= 224 ? 3 : t >= 192 ? 2 : 1;
Ge[254] = Ge[254] = 1;
var ja = (t) => {
  if (typeof TextEncoder == "function" && TextEncoder.prototype.encode)
    return new TextEncoder().encode(t);
  let i, e, r, n, a, l = t.length, o = 0;
  for (n = 0; n < l; n++)
    e = t.charCodeAt(n), (e & 64512) === 55296 && n + 1 < l && (r = t.charCodeAt(n + 1), (r & 64512) === 56320 && (e = 65536 + (e - 55296 << 10) + (r - 56320), n++)), o += e < 128 ? 1 : e < 2048 ? 2 : e < 65536 ? 3 : 4;
  for (i = new Uint8Array(o), a = 0, n = 0; a < o; n++)
    e = t.charCodeAt(n), (e & 64512) === 55296 && n + 1 < l && (r = t.charCodeAt(n + 1), (r & 64512) === 56320 && (e = 65536 + (e - 55296 << 10) + (r - 56320), n++)), e < 128 ? i[a++] = e : e < 2048 ? (i[a++] = 192 | e >>> 6, i[a++] = 128 | e & 63) : e < 65536 ? (i[a++] = 224 | e >>> 12, i[a++] = 128 | e >>> 6 & 63, i[a++] = 128 | e & 63) : (i[a++] = 240 | e >>> 18, i[a++] = 128 | e >>> 12 & 63, i[a++] = 128 | e >>> 6 & 63, i[a++] = 128 | e & 63);
  return i;
};
const Ka = (t, i) => {
  if (i < 65534 && t.subarray && Dr)
    return String.fromCharCode.apply(null, t.length === i ? t : t.subarray(0, i));
  let e = "";
  for (let r = 0; r < i; r++)
    e += String.fromCharCode(t[r]);
  return e;
};
var Ga = (t, i) => {
  const e = i || t.length;
  if (typeof TextDecoder == "function" && TextDecoder.prototype.decode)
    return new TextDecoder().decode(t.subarray(0, i));
  let r, n;
  const a = new Array(e * 2);
  for (n = 0, r = 0; r < e; ) {
    let l = t[r++];
    if (l < 128) {
      a[n++] = l;
      continue;
    }
    let o = Ge[l];
    if (o > 4) {
      a[n++] = 65533, r += o - 1;
      continue;
    }
    for (l &= o === 2 ? 31 : o === 3 ? 15 : 7; o > 1 && r < e; )
      l = l << 6 | t[r++] & 63, o--;
    if (o > 1) {
      a[n++] = 65533;
      continue;
    }
    l < 65536 ? a[n++] = l : (l -= 65536, a[n++] = 55296 | l >> 10 & 1023, a[n++] = 56320 | l & 1023);
  }
  return Ka(a, n);
}, Ya = (t, i) => {
  i = i || t.length, i > t.length && (i = t.length);
  let e = i - 1;
  for (; e >= 0 && (t[e] & 192) === 128; )
    e--;
  return e <= 0 ? i : e + Ge[t[e]] > i ? e : i;
}, Ye = {
  string2buf: ja,
  buf2string: Ga,
  utf8border: Ya
};
function Xa() {
  this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
}
var Lr = Xa;
const Vr = Object.prototype.toString, {
  Z_NO_FLUSH: qa,
  Z_SYNC_FLUSH: Ja,
  Z_FULL_FLUSH: Qa,
  Z_FINISH: es,
  Z_OK: ct,
  Z_STREAM_END: ts,
  Z_DEFAULT_COMPRESSION: is,
  Z_DEFAULT_STRATEGY: rs,
  Z_DEFLATED: ns
} = Qe;
function ii(t) {
  this.options = wt.assign({
    level: is,
    method: ns,
    chunkSize: 16384,
    windowBits: 15,
    memLevel: 8,
    strategy: rs
  }, t || {});
  let i = this.options;
  i.raw && i.windowBits > 0 ? i.windowBits = -i.windowBits : i.gzip && i.windowBits > 0 && i.windowBits < 16 && (i.windowBits += 16), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new Lr(), this.strm.avail_out = 0;
  let e = Be.deflateInit2(
    this.strm,
    i.level,
    i.method,
    i.windowBits,
    i.memLevel,
    i.strategy
  );
  if (e !== ct)
    throw new Error(Ae[e]);
  if (i.header && Be.deflateSetHeader(this.strm, i.header), i.dictionary) {
    let r;
    if (typeof i.dictionary == "string" ? r = Ye.string2buf(i.dictionary) : Vr.call(i.dictionary) === "[object ArrayBuffer]" ? r = new Uint8Array(i.dictionary) : r = i.dictionary, e = Be.deflateSetDictionary(this.strm, r), e !== ct)
      throw new Error(Ae[e]);
    this._dict_set = !0;
  }
}
ii.prototype.push = function(t, i) {
  const e = this.strm, r = this.options.chunkSize;
  let n, a;
  if (this.ended)
    return !1;
  for (i === ~~i ? a = i : a = i === !0 ? es : qa, typeof t == "string" ? e.input = Ye.string2buf(t) : Vr.call(t) === "[object ArrayBuffer]" ? e.input = new Uint8Array(t) : e.input = t, e.next_in = 0, e.avail_in = e.input.length; ; ) {
    if (e.avail_out === 0 && (e.output = new Uint8Array(r), e.next_out = 0, e.avail_out = r), (a === Ja || a === Qa) && e.avail_out <= 6) {
      this.onData(e.output.subarray(0, e.next_out)), e.avail_out = 0;
      continue;
    }
    if (n = Be.deflate(e, a), n === ts)
      return e.next_out > 0 && this.onData(e.output.subarray(0, e.next_out)), n = Be.deflateEnd(this.strm), this.onEnd(n), this.ended = !0, n === ct;
    if (e.avail_out === 0) {
      this.onData(e.output);
      continue;
    }
    if (a > 0 && e.next_out > 0) {
      this.onData(e.output.subarray(0, e.next_out)), e.avail_out = 0;
      continue;
    }
    if (e.avail_in === 0)
      break;
  }
  return !0;
};
ii.prototype.onData = function(t) {
  this.chunks.push(t);
};
ii.prototype.onEnd = function(t) {
  t === ct && (this.result = wt.flattenChunks(this.chunks)), this.chunks = [], this.err = t, this.msg = this.strm.msg;
};
const ot = 16209, as = 16191;
var ss = function(i, e) {
  let r, n, a, l, o, c, s, h, g, _, u, v, $, C, E, N, x, y, T, f, d, w, b, p;
  const m = i.state;
  r = i.next_in, b = i.input, n = r + (i.avail_in - 5), a = i.next_out, p = i.output, l = a - (e - i.avail_out), o = a + (i.avail_out - 257), c = m.dmax, s = m.wsize, h = m.whave, g = m.wnext, _ = m.window, u = m.hold, v = m.bits, $ = m.lencode, C = m.distcode, E = (1 << m.lenbits) - 1, N = (1 << m.distbits) - 1;
  e:
    do {
      v < 15 && (u += b[r++] << v, v += 8, u += b[r++] << v, v += 8), x = $[u & E];
      t:
        for (; ; ) {
          if (y = x >>> 24, u >>>= y, v -= y, y = x >>> 16 & 255, y === 0)
            p[a++] = x & 65535;
          else if (y & 16) {
            T = x & 65535, y &= 15, y && (v < y && (u += b[r++] << v, v += 8), T += u & (1 << y) - 1, u >>>= y, v -= y), v < 15 && (u += b[r++] << v, v += 8, u += b[r++] << v, v += 8), x = C[u & N];
            i:
              for (; ; ) {
                if (y = x >>> 24, u >>>= y, v -= y, y = x >>> 16 & 255, y & 16) {
                  if (f = x & 65535, y &= 15, v < y && (u += b[r++] << v, v += 8, v < y && (u += b[r++] << v, v += 8)), f += u & (1 << y) - 1, f > c) {
                    i.msg = "invalid distance too far back", m.mode = ot;
                    break e;
                  }
                  if (u >>>= y, v -= y, y = a - l, f > y) {
                    if (y = f - y, y > h && m.sane) {
                      i.msg = "invalid distance too far back", m.mode = ot;
                      break e;
                    }
                    if (d = 0, w = _, g === 0) {
                      if (d += s - y, y < T) {
                        T -= y;
                        do
                          p[a++] = _[d++];
                        while (--y);
                        d = a - f, w = p;
                      }
                    } else if (g < y) {
                      if (d += s + g - y, y -= g, y < T) {
                        T -= y;
                        do
                          p[a++] = _[d++];
                        while (--y);
                        if (d = 0, g < T) {
                          y = g, T -= y;
                          do
                            p[a++] = _[d++];
                          while (--y);
                          d = a - f, w = p;
                        }
                      }
                    } else if (d += g - y, y < T) {
                      T -= y;
                      do
                        p[a++] = _[d++];
                      while (--y);
                      d = a - f, w = p;
                    }
                    for (; T > 2; )
                      p[a++] = w[d++], p[a++] = w[d++], p[a++] = w[d++], T -= 3;
                    T && (p[a++] = w[d++], T > 1 && (p[a++] = w[d++]));
                  } else {
                    d = a - f;
                    do
                      p[a++] = p[d++], p[a++] = p[d++], p[a++] = p[d++], T -= 3;
                    while (T > 2);
                    T && (p[a++] = p[d++], T > 1 && (p[a++] = p[d++]));
                  }
                } else if ((y & 64) === 0) {
                  x = C[(x & 65535) + (u & (1 << y) - 1)];
                  continue i;
                } else {
                  i.msg = "invalid distance code", m.mode = ot;
                  break e;
                }
                break;
              }
          } else if ((y & 64) === 0) {
            x = $[(x & 65535) + (u & (1 << y) - 1)];
            continue t;
          } else if (y & 32) {
            m.mode = as;
            break e;
          } else {
            i.msg = "invalid literal/length code", m.mode = ot;
            break e;
          }
          break;
        }
    } while (r < n && a < o);
  T = v >> 3, r -= T, v -= T << 3, u &= (1 << v) - 1, i.next_in = r, i.next_out = a, i.avail_in = r < n ? 5 + (n - r) : 5 - (r - n), i.avail_out = a < o ? 257 + (o - a) : 257 - (a - o), m.hold = u, m.bits = v;
};
const ve = 15, yi = 852, mi = 592, vi = 0, St = 1, ki = 2, os = new Uint16Array([
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  13,
  15,
  17,
  19,
  23,
  27,
  31,
  35,
  43,
  51,
  59,
  67,
  83,
  99,
  115,
  131,
  163,
  195,
  227,
  258,
  0,
  0
]), ls = new Uint8Array([
  16,
  16,
  16,
  16,
  16,
  16,
  16,
  16,
  17,
  17,
  17,
  17,
  18,
  18,
  18,
  18,
  19,
  19,
  19,
  19,
  20,
  20,
  20,
  20,
  21,
  21,
  21,
  21,
  16,
  72,
  78
]), hs = new Uint16Array([
  1,
  2,
  3,
  4,
  5,
  7,
  9,
  13,
  17,
  25,
  33,
  49,
  65,
  97,
  129,
  193,
  257,
  385,
  513,
  769,
  1025,
  1537,
  2049,
  3073,
  4097,
  6145,
  8193,
  12289,
  16385,
  24577,
  0,
  0
]), fs = new Uint8Array([
  16,
  16,
  16,
  16,
  17,
  17,
  18,
  18,
  19,
  19,
  20,
  20,
  21,
  21,
  22,
  22,
  23,
  23,
  24,
  24,
  25,
  25,
  26,
  26,
  27,
  27,
  28,
  28,
  29,
  29,
  64,
  64
]), ds = (t, i, e, r, n, a, l, o) => {
  const c = o.bits;
  let s = 0, h = 0, g = 0, _ = 0, u = 0, v = 0, $ = 0, C = 0, E = 0, N = 0, x, y, T, f, d, w = null, b;
  const p = new Uint16Array(ve + 1), m = new Uint16Array(ve + 1);
  let A = null, I, M, W;
  for (s = 0; s <= ve; s++)
    p[s] = 0;
  for (h = 0; h < r; h++)
    p[i[e + h]]++;
  for (u = c, _ = ve; _ >= 1 && p[_] === 0; _--)
    ;
  if (u > _ && (u = _), _ === 0)
    return n[a++] = 1 << 24 | 64 << 16 | 0, n[a++] = 1 << 24 | 64 << 16 | 0, o.bits = 1, 0;
  for (g = 1; g < _ && p[g] === 0; g++)
    ;
  for (u < g && (u = g), C = 1, s = 1; s <= ve; s++)
    if (C <<= 1, C -= p[s], C < 0)
      return -1;
  if (C > 0 && (t === vi || _ !== 1))
    return -1;
  for (m[1] = 0, s = 1; s < ve; s++)
    m[s + 1] = m[s] + p[s];
  for (h = 0; h < r; h++)
    i[e + h] !== 0 && (l[m[i[e + h]]++] = h);
  if (t === vi ? (w = A = l, b = 20) : t === St ? (w = os, A = ls, b = 257) : (w = hs, A = fs, b = 0), N = 0, h = 0, s = g, d = a, v = u, $ = 0, T = -1, E = 1 << u, f = E - 1, t === St && E > yi || t === ki && E > mi)
    return 1;
  for (; ; ) {
    I = s - $, l[h] + 1 < b ? (M = 0, W = l[h]) : l[h] >= b ? (M = A[l[h] - b], W = w[l[h] - b]) : (M = 32 + 64, W = 0), x = 1 << s - $, y = 1 << v, g = y;
    do
      y -= x, n[d + (N >> $) + y] = I << 24 | M << 16 | W | 0;
    while (y !== 0);
    for (x = 1 << s - 1; N & x; )
      x >>= 1;
    if (x !== 0 ? (N &= x - 1, N += x) : N = 0, h++, --p[s] === 0) {
      if (s === _)
        break;
      s = i[e + l[h]];
    }
    if (s > u && (N & f) !== T) {
      for ($ === 0 && ($ = u), d += g, v = s - $, C = 1 << v; v + $ < _ && (C -= p[v + $], !(C <= 0)); )
        v++, C <<= 1;
      if (E += 1 << v, t === St && E > yi || t === ki && E > mi)
        return 1;
      T = N & f, n[T] = u << 24 | v << 16 | d - a | 0;
    }
  }
  return N !== 0 && (n[d + N] = s - $ << 24 | 64 << 16 | 0), o.bits = u, 0;
};
var Fe = ds;
const us = 0, Mr = 1, Br = 2, {
  Z_FINISH: Ei,
  Z_BLOCK: cs,
  Z_TREES: lt,
  Z_OK: be,
  Z_STREAM_END: ps,
  Z_NEED_DICT: _s,
  Z_STREAM_ERROR: K,
  Z_DATA_ERROR: Fr,
  Z_MEM_ERROR: Zr,
  Z_BUF_ERROR: bs,
  Z_DEFLATED: Ci
} = Qe, yt = 16180, Ai = 16181, $i = 16182, xi = 16183, Ni = 16184, Ui = 16185, Ti = 16186, Si = 16187, Ri = 16188, Ii = 16189, pt = 16190, te = 16191, Rt = 16192, Oi = 16193, It = 16194, zi = 16195, Di = 16196, Li = 16197, Vi = 16198, ht = 16199, ft = 16200, Mi = 16201, Bi = 16202, Fi = 16203, Zi = 16204, Pi = 16205, Ot = 16206, Hi = 16207, Wi = 16208, O = 16209, Pr = 16210, Hr = 16211, gs = 852, ws = 592, ys = 15, ms = ys, ji = (t) => (t >>> 24 & 255) + (t >>> 8 & 65280) + ((t & 65280) << 8) + ((t & 255) << 24);
function vs() {
  this.strm = null, this.mode = 0, this.last = !1, this.wrap = 0, this.havedict = !1, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new Uint16Array(320), this.work = new Uint16Array(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
}
const ge = (t) => {
  if (!t)
    return 1;
  const i = t.state;
  return !i || i.strm !== t || i.mode < yt || i.mode > Hr ? 1 : 0;
}, Wr = (t) => {
  if (ge(t))
    return K;
  const i = t.state;
  return t.total_in = t.total_out = i.total = 0, t.msg = "", i.wrap && (t.adler = i.wrap & 1), i.mode = yt, i.last = 0, i.havedict = 0, i.flags = -1, i.dmax = 32768, i.head = null, i.hold = 0, i.bits = 0, i.lencode = i.lendyn = new Int32Array(gs), i.distcode = i.distdyn = new Int32Array(ws), i.sane = 1, i.back = -1, be;
}, jr = (t) => {
  if (ge(t))
    return K;
  const i = t.state;
  return i.wsize = 0, i.whave = 0, i.wnext = 0, Wr(t);
}, Kr = (t, i) => {
  let e;
  if (ge(t))
    return K;
  const r = t.state;
  return i < 0 ? (e = 0, i = -i) : (e = (i >> 4) + 5, i < 48 && (i &= 15)), i && (i < 8 || i > 15) ? K : (r.window !== null && r.wbits !== i && (r.window = null), r.wrap = e, r.wbits = i, jr(t));
}, Gr = (t, i) => {
  if (!t)
    return K;
  const e = new vs();
  t.state = e, e.strm = t, e.window = null, e.mode = yt;
  const r = Kr(t, i);
  return r !== be && (t.state = null), r;
}, ks = (t) => Gr(t, ms);
let Ki = !0, zt, Dt;
const Es = (t) => {
  if (Ki) {
    zt = new Int32Array(512), Dt = new Int32Array(32);
    let i = 0;
    for (; i < 144; )
      t.lens[i++] = 8;
    for (; i < 256; )
      t.lens[i++] = 9;
    for (; i < 280; )
      t.lens[i++] = 7;
    for (; i < 288; )
      t.lens[i++] = 8;
    for (Fe(Mr, t.lens, 0, 288, zt, 0, t.work, { bits: 9 }), i = 0; i < 32; )
      t.lens[i++] = 5;
    Fe(Br, t.lens, 0, 32, Dt, 0, t.work, { bits: 5 }), Ki = !1;
  }
  t.lencode = zt, t.lenbits = 9, t.distcode = Dt, t.distbits = 5;
}, Yr = (t, i, e, r) => {
  let n;
  const a = t.state;
  return a.window === null && (a.wsize = 1 << a.wbits, a.wnext = 0, a.whave = 0, a.window = new Uint8Array(a.wsize)), r >= a.wsize ? (a.window.set(i.subarray(e - a.wsize, e), 0), a.wnext = 0, a.whave = a.wsize) : (n = a.wsize - a.wnext, n > r && (n = r), a.window.set(i.subarray(e - r, e - r + n), a.wnext), r -= n, r ? (a.window.set(i.subarray(e - r, e), 0), a.wnext = r, a.whave = a.wsize) : (a.wnext += n, a.wnext === a.wsize && (a.wnext = 0), a.whave < a.wsize && (a.whave += n))), 0;
}, Cs = (t, i) => {
  let e, r, n, a, l, o, c, s, h, g, _, u, v, $, C = 0, E, N, x, y, T, f, d, w;
  const b = new Uint8Array(4);
  let p, m;
  const A = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
  if (ge(t) || !t.output || !t.input && t.avail_in !== 0)
    return K;
  e = t.state, e.mode === te && (e.mode = Rt), l = t.next_out, n = t.output, c = t.avail_out, a = t.next_in, r = t.input, o = t.avail_in, s = e.hold, h = e.bits, g = o, _ = c, w = be;
  e:
    for (; ; )
      switch (e.mode) {
        case yt:
          if (e.wrap === 0) {
            e.mode = Rt;
            break;
          }
          for (; h < 16; ) {
            if (o === 0)
              break e;
            o--, s += r[a++] << h, h += 8;
          }
          if (e.wrap & 2 && s === 35615) {
            e.wbits === 0 && (e.wbits = 15), e.check = 0, b[0] = s & 255, b[1] = s >>> 8 & 255, e.check = z(e.check, b, 2, 0), s = 0, h = 0, e.mode = Ai;
            break;
          }
          if (e.head && (e.head.done = !1), !(e.wrap & 1) || (((s & 255) << 8) + (s >> 8)) % 31) {
            t.msg = "incorrect header check", e.mode = O;
            break;
          }
          if ((s & 15) !== Ci) {
            t.msg = "unknown compression method", e.mode = O;
            break;
          }
          if (s >>>= 4, h -= 4, d = (s & 15) + 8, e.wbits === 0 && (e.wbits = d), d > 15 || d > e.wbits) {
            t.msg = "invalid window size", e.mode = O;
            break;
          }
          e.dmax = 1 << e.wbits, e.flags = 0, t.adler = e.check = 1, e.mode = s & 512 ? Ii : te, s = 0, h = 0;
          break;
        case Ai:
          for (; h < 16; ) {
            if (o === 0)
              break e;
            o--, s += r[a++] << h, h += 8;
          }
          if (e.flags = s, (e.flags & 255) !== Ci) {
            t.msg = "unknown compression method", e.mode = O;
            break;
          }
          if (e.flags & 57344) {
            t.msg = "unknown header flags set", e.mode = O;
            break;
          }
          e.head && (e.head.text = s >> 8 & 1), e.flags & 512 && e.wrap & 4 && (b[0] = s & 255, b[1] = s >>> 8 & 255, e.check = z(e.check, b, 2, 0)), s = 0, h = 0, e.mode = $i;
        case $i:
          for (; h < 32; ) {
            if (o === 0)
              break e;
            o--, s += r[a++] << h, h += 8;
          }
          e.head && (e.head.time = s), e.flags & 512 && e.wrap & 4 && (b[0] = s & 255, b[1] = s >>> 8 & 255, b[2] = s >>> 16 & 255, b[3] = s >>> 24 & 255, e.check = z(e.check, b, 4, 0)), s = 0, h = 0, e.mode = xi;
        case xi:
          for (; h < 16; ) {
            if (o === 0)
              break e;
            o--, s += r[a++] << h, h += 8;
          }
          e.head && (e.head.xflags = s & 255, e.head.os = s >> 8), e.flags & 512 && e.wrap & 4 && (b[0] = s & 255, b[1] = s >>> 8 & 255, e.check = z(e.check, b, 2, 0)), s = 0, h = 0, e.mode = Ni;
        case Ni:
          if (e.flags & 1024) {
            for (; h < 16; ) {
              if (o === 0)
                break e;
              o--, s += r[a++] << h, h += 8;
            }
            e.length = s, e.head && (e.head.extra_len = s), e.flags & 512 && e.wrap & 4 && (b[0] = s & 255, b[1] = s >>> 8 & 255, e.check = z(e.check, b, 2, 0)), s = 0, h = 0;
          } else
            e.head && (e.head.extra = null);
          e.mode = Ui;
        case Ui:
          if (e.flags & 1024 && (u = e.length, u > o && (u = o), u && (e.head && (d = e.head.extra_len - e.length, e.head.extra || (e.head.extra = new Uint8Array(e.head.extra_len)), e.head.extra.set(
            r.subarray(
              a,
              a + u
            ),
            d
          )), e.flags & 512 && e.wrap & 4 && (e.check = z(e.check, r, u, a)), o -= u, a += u, e.length -= u), e.length))
            break e;
          e.length = 0, e.mode = Ti;
        case Ti:
          if (e.flags & 2048) {
            if (o === 0)
              break e;
            u = 0;
            do
              d = r[a + u++], e.head && d && e.length < 65536 && (e.head.name += String.fromCharCode(d));
            while (d && u < o);
            if (e.flags & 512 && e.wrap & 4 && (e.check = z(e.check, r, u, a)), o -= u, a += u, d)
              break e;
          } else
            e.head && (e.head.name = null);
          e.length = 0, e.mode = Si;
        case Si:
          if (e.flags & 4096) {
            if (o === 0)
              break e;
            u = 0;
            do
              d = r[a + u++], e.head && d && e.length < 65536 && (e.head.comment += String.fromCharCode(d));
            while (d && u < o);
            if (e.flags & 512 && e.wrap & 4 && (e.check = z(e.check, r, u, a)), o -= u, a += u, d)
              break e;
          } else
            e.head && (e.head.comment = null);
          e.mode = Ri;
        case Ri:
          if (e.flags & 512) {
            for (; h < 16; ) {
              if (o === 0)
                break e;
              o--, s += r[a++] << h, h += 8;
            }
            if (e.wrap & 4 && s !== (e.check & 65535)) {
              t.msg = "header crc mismatch", e.mode = O;
              break;
            }
            s = 0, h = 0;
          }
          e.head && (e.head.hcrc = e.flags >> 9 & 1, e.head.done = !0), t.adler = e.check = 0, e.mode = te;
          break;
        case Ii:
          for (; h < 32; ) {
            if (o === 0)
              break e;
            o--, s += r[a++] << h, h += 8;
          }
          t.adler = e.check = ji(s), s = 0, h = 0, e.mode = pt;
        case pt:
          if (e.havedict === 0)
            return t.next_out = l, t.avail_out = c, t.next_in = a, t.avail_in = o, e.hold = s, e.bits = h, _s;
          t.adler = e.check = 1, e.mode = te;
        case te:
          if (i === cs || i === lt)
            break e;
        case Rt:
          if (e.last) {
            s >>>= h & 7, h -= h & 7, e.mode = Ot;
            break;
          }
          for (; h < 3; ) {
            if (o === 0)
              break e;
            o--, s += r[a++] << h, h += 8;
          }
          switch (e.last = s & 1, s >>>= 1, h -= 1, s & 3) {
            case 0:
              e.mode = Oi;
              break;
            case 1:
              if (Es(e), e.mode = ht, i === lt) {
                s >>>= 2, h -= 2;
                break e;
              }
              break;
            case 2:
              e.mode = Di;
              break;
            case 3:
              t.msg = "invalid block type", e.mode = O;
          }
          s >>>= 2, h -= 2;
          break;
        case Oi:
          for (s >>>= h & 7, h -= h & 7; h < 32; ) {
            if (o === 0)
              break e;
            o--, s += r[a++] << h, h += 8;
          }
          if ((s & 65535) !== (s >>> 16 ^ 65535)) {
            t.msg = "invalid stored block lengths", e.mode = O;
            break;
          }
          if (e.length = s & 65535, s = 0, h = 0, e.mode = It, i === lt)
            break e;
        case It:
          e.mode = zi;
        case zi:
          if (u = e.length, u) {
            if (u > o && (u = o), u > c && (u = c), u === 0)
              break e;
            n.set(r.subarray(a, a + u), l), o -= u, a += u, c -= u, l += u, e.length -= u;
            break;
          }
          e.mode = te;
          break;
        case Di:
          for (; h < 14; ) {
            if (o === 0)
              break e;
            o--, s += r[a++] << h, h += 8;
          }
          if (e.nlen = (s & 31) + 257, s >>>= 5, h -= 5, e.ndist = (s & 31) + 1, s >>>= 5, h -= 5, e.ncode = (s & 15) + 4, s >>>= 4, h -= 4, e.nlen > 286 || e.ndist > 30) {
            t.msg = "too many length or distance symbols", e.mode = O;
            break;
          }
          e.have = 0, e.mode = Li;
        case Li:
          for (; e.have < e.ncode; ) {
            for (; h < 3; ) {
              if (o === 0)
                break e;
              o--, s += r[a++] << h, h += 8;
            }
            e.lens[A[e.have++]] = s & 7, s >>>= 3, h -= 3;
          }
          for (; e.have < 19; )
            e.lens[A[e.have++]] = 0;
          if (e.lencode = e.lendyn, e.lenbits = 7, p = { bits: e.lenbits }, w = Fe(us, e.lens, 0, 19, e.lencode, 0, e.work, p), e.lenbits = p.bits, w) {
            t.msg = "invalid code lengths set", e.mode = O;
            break;
          }
          e.have = 0, e.mode = Vi;
        case Vi:
          for (; e.have < e.nlen + e.ndist; ) {
            for (; C = e.lencode[s & (1 << e.lenbits) - 1], E = C >>> 24, N = C >>> 16 & 255, x = C & 65535, !(E <= h); ) {
              if (o === 0)
                break e;
              o--, s += r[a++] << h, h += 8;
            }
            if (x < 16)
              s >>>= E, h -= E, e.lens[e.have++] = x;
            else {
              if (x === 16) {
                for (m = E + 2; h < m; ) {
                  if (o === 0)
                    break e;
                  o--, s += r[a++] << h, h += 8;
                }
                if (s >>>= E, h -= E, e.have === 0) {
                  t.msg = "invalid bit length repeat", e.mode = O;
                  break;
                }
                d = e.lens[e.have - 1], u = 3 + (s & 3), s >>>= 2, h -= 2;
              } else if (x === 17) {
                for (m = E + 3; h < m; ) {
                  if (o === 0)
                    break e;
                  o--, s += r[a++] << h, h += 8;
                }
                s >>>= E, h -= E, d = 0, u = 3 + (s & 7), s >>>= 3, h -= 3;
              } else {
                for (m = E + 7; h < m; ) {
                  if (o === 0)
                    break e;
                  o--, s += r[a++] << h, h += 8;
                }
                s >>>= E, h -= E, d = 0, u = 11 + (s & 127), s >>>= 7, h -= 7;
              }
              if (e.have + u > e.nlen + e.ndist) {
                t.msg = "invalid bit length repeat", e.mode = O;
                break;
              }
              for (; u--; )
                e.lens[e.have++] = d;
            }
          }
          if (e.mode === O)
            break;
          if (e.lens[256] === 0) {
            t.msg = "invalid code -- missing end-of-block", e.mode = O;
            break;
          }
          if (e.lenbits = 9, p = { bits: e.lenbits }, w = Fe(Mr, e.lens, 0, e.nlen, e.lencode, 0, e.work, p), e.lenbits = p.bits, w) {
            t.msg = "invalid literal/lengths set", e.mode = O;
            break;
          }
          if (e.distbits = 6, e.distcode = e.distdyn, p = { bits: e.distbits }, w = Fe(Br, e.lens, e.nlen, e.ndist, e.distcode, 0, e.work, p), e.distbits = p.bits, w) {
            t.msg = "invalid distances set", e.mode = O;
            break;
          }
          if (e.mode = ht, i === lt)
            break e;
        case ht:
          e.mode = ft;
        case ft:
          if (o >= 6 && c >= 258) {
            t.next_out = l, t.avail_out = c, t.next_in = a, t.avail_in = o, e.hold = s, e.bits = h, ss(t, _), l = t.next_out, n = t.output, c = t.avail_out, a = t.next_in, r = t.input, o = t.avail_in, s = e.hold, h = e.bits, e.mode === te && (e.back = -1);
            break;
          }
          for (e.back = 0; C = e.lencode[s & (1 << e.lenbits) - 1], E = C >>> 24, N = C >>> 16 & 255, x = C & 65535, !(E <= h); ) {
            if (o === 0)
              break e;
            o--, s += r[a++] << h, h += 8;
          }
          if (N && (N & 240) === 0) {
            for (y = E, T = N, f = x; C = e.lencode[f + ((s & (1 << y + T) - 1) >> y)], E = C >>> 24, N = C >>> 16 & 255, x = C & 65535, !(y + E <= h); ) {
              if (o === 0)
                break e;
              o--, s += r[a++] << h, h += 8;
            }
            s >>>= y, h -= y, e.back += y;
          }
          if (s >>>= E, h -= E, e.back += E, e.length = x, N === 0) {
            e.mode = Pi;
            break;
          }
          if (N & 32) {
            e.back = -1, e.mode = te;
            break;
          }
          if (N & 64) {
            t.msg = "invalid literal/length code", e.mode = O;
            break;
          }
          e.extra = N & 15, e.mode = Mi;
        case Mi:
          if (e.extra) {
            for (m = e.extra; h < m; ) {
              if (o === 0)
                break e;
              o--, s += r[a++] << h, h += 8;
            }
            e.length += s & (1 << e.extra) - 1, s >>>= e.extra, h -= e.extra, e.back += e.extra;
          }
          e.was = e.length, e.mode = Bi;
        case Bi:
          for (; C = e.distcode[s & (1 << e.distbits) - 1], E = C >>> 24, N = C >>> 16 & 255, x = C & 65535, !(E <= h); ) {
            if (o === 0)
              break e;
            o--, s += r[a++] << h, h += 8;
          }
          if ((N & 240) === 0) {
            for (y = E, T = N, f = x; C = e.distcode[f + ((s & (1 << y + T) - 1) >> y)], E = C >>> 24, N = C >>> 16 & 255, x = C & 65535, !(y + E <= h); ) {
              if (o === 0)
                break e;
              o--, s += r[a++] << h, h += 8;
            }
            s >>>= y, h -= y, e.back += y;
          }
          if (s >>>= E, h -= E, e.back += E, N & 64) {
            t.msg = "invalid distance code", e.mode = O;
            break;
          }
          e.offset = x, e.extra = N & 15, e.mode = Fi;
        case Fi:
          if (e.extra) {
            for (m = e.extra; h < m; ) {
              if (o === 0)
                break e;
              o--, s += r[a++] << h, h += 8;
            }
            e.offset += s & (1 << e.extra) - 1, s >>>= e.extra, h -= e.extra, e.back += e.extra;
          }
          if (e.offset > e.dmax) {
            t.msg = "invalid distance too far back", e.mode = O;
            break;
          }
          e.mode = Zi;
        case Zi:
          if (c === 0)
            break e;
          if (u = _ - c, e.offset > u) {
            if (u = e.offset - u, u > e.whave && e.sane) {
              t.msg = "invalid distance too far back", e.mode = O;
              break;
            }
            u > e.wnext ? (u -= e.wnext, v = e.wsize - u) : v = e.wnext - u, u > e.length && (u = e.length), $ = e.window;
          } else
            $ = n, v = l - e.offset, u = e.length;
          u > c && (u = c), c -= u, e.length -= u;
          do
            n[l++] = $[v++];
          while (--u);
          e.length === 0 && (e.mode = ft);
          break;
        case Pi:
          if (c === 0)
            break e;
          n[l++] = e.length, c--, e.mode = ft;
          break;
        case Ot:
          if (e.wrap) {
            for (; h < 32; ) {
              if (o === 0)
                break e;
              o--, s |= r[a++] << h, h += 8;
            }
            if (_ -= c, t.total_out += _, e.total += _, e.wrap & 4 && _ && (t.adler = e.check = e.flags ? z(e.check, n, _, l - _) : Ke(e.check, n, _, l - _)), _ = c, e.wrap & 4 && (e.flags ? s : ji(s)) !== e.check) {
              t.msg = "incorrect data check", e.mode = O;
              break;
            }
            s = 0, h = 0;
          }
          e.mode = Hi;
        case Hi:
          if (e.wrap && e.flags) {
            for (; h < 32; ) {
              if (o === 0)
                break e;
              o--, s += r[a++] << h, h += 8;
            }
            if (e.wrap & 4 && s !== (e.total & 4294967295)) {
              t.msg = "incorrect length check", e.mode = O;
              break;
            }
            s = 0, h = 0;
          }
          e.mode = Wi;
        case Wi:
          w = ps;
          break e;
        case O:
          w = Fr;
          break e;
        case Pr:
          return Zr;
        case Hr:
        default:
          return K;
      }
  return t.next_out = l, t.avail_out = c, t.next_in = a, t.avail_in = o, e.hold = s, e.bits = h, (e.wsize || _ !== t.avail_out && e.mode < O && (e.mode < Ot || i !== Ei)) && Yr(t, t.output, t.next_out, _ - t.avail_out), g -= t.avail_in, _ -= t.avail_out, t.total_in += g, t.total_out += _, e.total += _, e.wrap & 4 && _ && (t.adler = e.check = e.flags ? z(e.check, n, _, t.next_out - _) : Ke(e.check, n, _, t.next_out - _)), t.data_type = e.bits + (e.last ? 64 : 0) + (e.mode === te ? 128 : 0) + (e.mode === ht || e.mode === It ? 256 : 0), (g === 0 && _ === 0 || i === Ei) && w === be && (w = bs), w;
}, As = (t) => {
  if (ge(t))
    return K;
  let i = t.state;
  return i.window && (i.window = null), t.state = null, be;
}, $s = (t, i) => {
  if (ge(t))
    return K;
  const e = t.state;
  return (e.wrap & 2) === 0 ? K : (e.head = i, i.done = !1, be);
}, xs = (t, i) => {
  const e = i.length;
  let r, n, a;
  return ge(t) || (r = t.state, r.wrap !== 0 && r.mode !== pt) ? K : r.mode === pt && (n = 1, n = Ke(n, i, e, 0), n !== r.check) ? Fr : (a = Yr(t, i, e, e), a ? (r.mode = Pr, Zr) : (r.havedict = 1, be));
};
var Ns = jr, Us = Kr, Ts = Wr, Ss = ks, Rs = Gr, Is = Cs, Os = As, zs = $s, Ds = xs, Ls = "pako inflate (from Nodeca project)", ne = {
  inflateReset: Ns,
  inflateReset2: Us,
  inflateResetKeep: Ts,
  inflateInit: Ss,
  inflateInit2: Rs,
  inflate: Is,
  inflateEnd: Os,
  inflateGetHeader: zs,
  inflateSetDictionary: Ds,
  inflateInfo: Ls
};
function Vs() {
  this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = !1;
}
var Ms = Vs;
const Xr = Object.prototype.toString, {
  Z_NO_FLUSH: Bs,
  Z_FINISH: Fs,
  Z_OK: Xe,
  Z_STREAM_END: Lt,
  Z_NEED_DICT: Vt,
  Z_STREAM_ERROR: Zs,
  Z_DATA_ERROR: Gi,
  Z_MEM_ERROR: Ps
} = Qe;
function tt(t) {
  this.options = wt.assign({
    chunkSize: 1024 * 64,
    windowBits: 15,
    to: ""
  }, t || {});
  const i = this.options;
  i.raw && i.windowBits >= 0 && i.windowBits < 16 && (i.windowBits = -i.windowBits, i.windowBits === 0 && (i.windowBits = -15)), i.windowBits >= 0 && i.windowBits < 16 && !(t && t.windowBits) && (i.windowBits += 32), i.windowBits > 15 && i.windowBits < 48 && (i.windowBits & 15) === 0 && (i.windowBits |= 15), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new Lr(), this.strm.avail_out = 0;
  let e = ne.inflateInit2(
    this.strm,
    i.windowBits
  );
  if (e !== Xe)
    throw new Error(Ae[e]);
  if (this.header = new Ms(), ne.inflateGetHeader(this.strm, this.header), i.dictionary && (typeof i.dictionary == "string" ? i.dictionary = Ye.string2buf(i.dictionary) : Xr.call(i.dictionary) === "[object ArrayBuffer]" && (i.dictionary = new Uint8Array(i.dictionary)), i.raw && (e = ne.inflateSetDictionary(this.strm, i.dictionary), e !== Xe)))
    throw new Error(Ae[e]);
}
tt.prototype.push = function(t, i) {
  const e = this.strm, r = this.options.chunkSize, n = this.options.dictionary;
  let a, l, o;
  if (this.ended)
    return !1;
  for (i === ~~i ? l = i : l = i === !0 ? Fs : Bs, Xr.call(t) === "[object ArrayBuffer]" ? e.input = new Uint8Array(t) : e.input = t, e.next_in = 0, e.avail_in = e.input.length; ; ) {
    for (e.avail_out === 0 && (e.output = new Uint8Array(r), e.next_out = 0, e.avail_out = r), a = ne.inflate(e, l), a === Vt && n && (a = ne.inflateSetDictionary(e, n), a === Xe ? a = ne.inflate(e, l) : a === Gi && (a = Vt)); e.avail_in > 0 && a === Lt && e.state.wrap > 0 && t[e.next_in] !== 0; )
      ne.inflateReset(e), a = ne.inflate(e, l);
    switch (a) {
      case Zs:
      case Gi:
      case Vt:
      case Ps:
        return this.onEnd(a), this.ended = !0, !1;
    }
    if (o = e.avail_out, e.next_out && (e.avail_out === 0 || a === Lt))
      if (this.options.to === "string") {
        let c = Ye.utf8border(e.output, e.next_out), s = e.next_out - c, h = Ye.buf2string(e.output, c);
        e.next_out = s, e.avail_out = r - s, s && e.output.set(e.output.subarray(c, c + s), 0), this.onData(h);
      } else
        this.onData(e.output.length === e.next_out ? e.output : e.output.subarray(0, e.next_out));
    if (!(a === Xe && o === 0)) {
      if (a === Lt)
        return a = ne.inflateEnd(this.strm), this.onEnd(a), this.ended = !0, !0;
      if (e.avail_in === 0)
        break;
    }
  }
  return !0;
};
tt.prototype.onData = function(t) {
  this.chunks.push(t);
};
tt.prototype.onEnd = function(t) {
  t === Xe && (this.options.to === "string" ? this.result = this.chunks.join("") : this.result = wt.flattenChunks(this.chunks)), this.chunks = [], this.err = t, this.msg = this.strm.msg;
};
function ri(t, i) {
  const e = new tt(i);
  if (e.push(t), e.err)
    throw e.msg || Ae[e.err];
  return e.result;
}
function Hs(t, i) {
  return i = i || {}, i.raw = !0, ri(t, i);
}
var Ws = tt, js = ri, Ks = Hs, Gs = ri, Ys = Qe, Xs = {
  Inflate: Ws,
  inflate: js,
  inflateRaw: Ks,
  ungzip: Gs,
  constants: Ys
};
const { Inflate: qs, inflate: Js, inflateRaw: To, ungzip: So } = Xs;
var Qs = qs, eo = Js;
const Mt = [137, 80, 78, 71, 13, 10, 26, 10], qr = [];
for (let t = 0; t < 256; t++) {
  let i = t;
  for (let e = 0; e < 8; e++)
    i & 1 ? i = 3988292384 ^ i >>> 1 : i = i >>> 1;
  qr[t] = i;
}
const Yi = 4294967295;
function to(t, i, e) {
  let r = t;
  for (let n = 0; n < e; n++)
    r = qr[(r ^ i[n]) & 255] ^ r >>> 8;
  return r;
}
function io(t, i) {
  return (to(Yi, t, i) ^ Yi) >>> 0;
}
var de;
(function(t) {
  t[t.UNKNOWN = -1] = "UNKNOWN", t[t.GREYSCALE = 0] = "GREYSCALE", t[t.TRUECOLOUR = 2] = "TRUECOLOUR", t[t.INDEXED_COLOUR = 3] = "INDEXED_COLOUR", t[t.GREYSCALE_ALPHA = 4] = "GREYSCALE_ALPHA", t[t.TRUECOLOUR_ALPHA = 6] = "TRUECOLOUR_ALPHA";
})(de || (de = {}));
var Ze;
(function(t) {
  t[t.UNKNOWN = -1] = "UNKNOWN", t[t.DEFLATE = 0] = "DEFLATE";
})(Ze || (Ze = {}));
var _t;
(function(t) {
  t[t.UNKNOWN = -1] = "UNKNOWN", t[t.ADAPTIVE = 0] = "ADAPTIVE";
})(_t || (_t = {}));
var bt;
(function(t) {
  t[t.UNKNOWN = -1] = "UNKNOWN", t[t.NO_INTERLACE = 0] = "NO_INTERLACE", t[t.ADAM7 = 1] = "ADAM7";
})(bt || (bt = {}));
const ro = new Uint8Array(0), Xi = "\0", no = new Uint16Array([255]), ao = new Uint8Array(no.buffer), so = ao[0] === 255;
class oo extends Xt {
  constructor(i, e = {}) {
    super(i);
    const { checkCrc: r = !1 } = e;
    this._checkCrc = r, this._inflator = new Qs(), this._png = {
      width: -1,
      height: -1,
      channels: -1,
      data: new Uint8Array(0),
      depth: 1,
      text: {}
    }, this._end = !1, this._hasPalette = !1, this._palette = [], this._compressionMethod = Ze.UNKNOWN, this._filterMethod = _t.UNKNOWN, this._interlaceMethod = bt.UNKNOWN, this._colorType = -1, this.setBigEndian();
  }
  decode() {
    for (this.decodeSignature(); !this._end; )
      this.decodeChunk();
    return this.decodeImage(), this._png;
  }
  decodeSignature() {
    for (let i = 0; i < Mt.length; i++)
      if (this.readUint8() !== Mt[i])
        throw new Error(`wrong PNG signature. Byte at ${i} should be ${Mt[i]}.`);
  }
  decodeChunk() {
    const i = this.readUint32(), e = this.readChars(4), r = this.offset;
    switch (e) {
      case "IHDR":
        this.decodeIHDR();
        break;
      case "PLTE":
        this.decodePLTE(i);
        break;
      case "IDAT":
        this.decodeIDAT(i);
        break;
      case "IEND":
        this._end = !0;
        break;
      case "tRNS":
        this.decodetRNS(i);
        break;
      case "iCCP":
        this.decodeiCCP(i);
        break;
      case "tEXt":
        this.decodetEXt(i);
        break;
      case "pHYs":
        this.decodepHYs();
        break;
      default:
        this.skip(i);
        break;
    }
    if (this.offset - r !== i)
      throw new Error(`Length mismatch while decoding chunk ${e}`);
    if (this._checkCrc) {
      const n = this.readUint32(), a = i + 4, l = io(new Uint8Array(this.buffer, this.byteOffset + this.offset - a - 4, a), a);
      if (l !== n)
        throw new Error(`CRC mismatch for chunk ${e}. Expected ${n}, found ${l}`);
    } else
      this.skip(4);
  }
  decodeIHDR() {
    const i = this._png;
    i.width = this.readUint32(), i.height = this.readUint32(), i.depth = bo(this.readUint8());
    const e = this.readUint8();
    this._colorType = e;
    let r;
    switch (e) {
      case de.GREYSCALE:
        r = 1;
        break;
      case de.TRUECOLOUR:
        r = 3;
        break;
      case de.INDEXED_COLOUR:
        r = 1;
        break;
      case de.GREYSCALE_ALPHA:
        r = 2;
        break;
      case de.TRUECOLOUR_ALPHA:
        r = 4;
        break;
      default:
        throw new Error(`Unknown color type: ${e}`);
    }
    if (this._png.channels = r, this._compressionMethod = this.readUint8(), this._compressionMethod !== Ze.DEFLATE)
      throw new Error(`Unsupported compression method: ${this._compressionMethod}`);
    this._filterMethod = this.readUint8(), this._interlaceMethod = this.readUint8();
  }
  decodePLTE(i) {
    if (i % 3 !== 0)
      throw new RangeError(`PLTE field length must be a multiple of 3. Got ${i}`);
    const e = i / 3;
    this._hasPalette = !0;
    const r = [];
    this._palette = r;
    for (let n = 0; n < e; n++)
      r.push([this.readUint8(), this.readUint8(), this.readUint8()]);
  }
  decodeIDAT(i) {
    this._inflator.push(new Uint8Array(this.buffer, this.offset + this.byteOffset, i)), this.skip(i);
  }
  decodetRNS(i) {
    if (this._colorType === 3) {
      if (i > this._palette.length)
        throw new Error(`tRNS chunk contains more alpha values than there are palette colors (${i} vs ${this._palette.length})`);
      let e = 0;
      for (; e < i; e++) {
        const r = this.readByte();
        this._palette[e].push(r);
      }
      for (; e < this._palette.length; e++)
        this._palette[e].push(255);
    }
  }
  decodeiCCP(i) {
    let e = "", r;
    for (; (r = this.readChar()) !== Xi; )
      e += r;
    const n = this.readUint8();
    if (n !== Ze.DEFLATE)
      throw new Error(`Unsupported iCCP compression method: ${n}`);
    const a = this.readBytes(i - e.length - 2);
    this._png.iccEmbeddedProfile = {
      name: e,
      profile: eo(a)
    };
  }
  decodetEXt(i) {
    let e = "", r;
    for (; (r = this.readChar()) !== Xi; )
      e += r;
    this._png.text[e] = this.readChars(i - e.length - 1);
  }
  decodepHYs() {
    const i = this.readUint32(), e = this.readUint32(), r = this.readByte();
    this._png.resolution = { x: i, y: e, unit: r };
  }
  decodeImage() {
    if (this._inflator.err)
      throw new Error(`Error while decompressing the data: ${this._inflator.err}`);
    const i = this._inflator.result;
    if (this._filterMethod !== _t.ADAPTIVE)
      throw new Error(`Filter method ${this._filterMethod} not supported`);
    if (this._interlaceMethod === bt.NO_INTERLACE)
      this.decodeInterlaceNull(i);
    else
      throw new Error(`Interlace method ${this._interlaceMethod} not supported`);
  }
  decodeInterlaceNull(i) {
    const e = this._png.height, r = this._png.channels * this._png.depth / 8, n = this._png.width * r, a = new Uint8Array(this._png.height * n);
    let l = ro, o = 0, c, s;
    for (let h = 0; h < e; h++) {
      switch (c = i.subarray(o + 1, o + 1 + n), s = a.subarray(h * n, (h + 1) * n), i[o]) {
        case 0:
          lo(c, s, n);
          break;
        case 1:
          ho(c, s, n, r);
          break;
        case 2:
          fo(c, s, l, n);
          break;
        case 3:
          uo(c, s, l, n, r);
          break;
        case 4:
          co(c, s, l, n, r);
          break;
        default:
          throw new Error(`Unsupported filter: ${i[o]}`);
      }
      l = s, o += n + 1;
    }
    if (this._hasPalette && (this._png.palette = this._palette), this._png.depth === 16) {
      const h = new Uint16Array(a.buffer);
      if (so)
        for (let g = 0; g < h.length; g++)
          h[g] = _o(h[g]);
      this._png.data = h;
    } else
      this._png.data = a;
  }
}
function lo(t, i, e) {
  for (let r = 0; r < e; r++)
    i[r] = t[r];
}
function ho(t, i, e, r) {
  let n = 0;
  for (; n < r; n++)
    i[n] = t[n];
  for (; n < e; n++)
    i[n] = t[n] + i[n - r] & 255;
}
function fo(t, i, e, r) {
  let n = 0;
  if (e.length === 0)
    for (; n < r; n++)
      i[n] = t[n];
  else
    for (; n < r; n++)
      i[n] = t[n] + e[n] & 255;
}
function uo(t, i, e, r, n) {
  let a = 0;
  if (e.length === 0) {
    for (; a < n; a++)
      i[a] = t[a];
    for (; a < r; a++)
      i[a] = t[a] + (i[a - n] >> 1) & 255;
  } else {
    for (; a < n; a++)
      i[a] = t[a] + (e[a] >> 1) & 255;
    for (; a < r; a++)
      i[a] = t[a] + (i[a - n] + e[a] >> 1) & 255;
  }
}
function co(t, i, e, r, n) {
  let a = 0;
  if (e.length === 0) {
    for (; a < n; a++)
      i[a] = t[a];
    for (; a < r; a++)
      i[a] = t[a] + i[a - n] & 255;
  } else {
    for (; a < n; a++)
      i[a] = t[a] + e[a] & 255;
    for (; a < r; a++)
      i[a] = t[a] + po(i[a - n], e[a], e[a - n]) & 255;
  }
}
function po(t, i, e) {
  const r = t + i - e, n = Math.abs(r - t), a = Math.abs(r - i), l = Math.abs(r - e);
  return n <= a && n <= l ? t : a <= l ? i : e;
}
function _o(t) {
  return (t & 255) << 8 | t >> 8 & 255;
}
function bo(t) {
  if (t !== 1 && t !== 2 && t !== 4 && t !== 8 && t !== 16)
    throw new Error(`invalid bit depth: ${t}`);
  return t;
}
var qi;
(function(t) {
  t[t.UNKNOWN = 0] = "UNKNOWN", t[t.METRE = 1] = "METRE";
})(qi || (qi = {}));
function go(t, i) {
  return new oo(t, i).decode();
}
var Jr = {}, ee = {};
Object.defineProperty(ee, "__esModule", { value: !0 });
ee.handleWarning = ee.DecodeWarning = ee.DecodeError = void 0;
class wo extends Error {
  constructor(i, e, r) {
    super(e), this.offset = r, this.partiallyDecodedImage = {
      details: {
        header: i.header,
        footer: i.footer,
        imageId: i.identificationField,
        developerDirectory: i.developerDirectory,
        extensionArea: i.extensionArea
      },
      warnings: i.warnings
    };
  }
}
ee.DecodeError = wo;
class yo extends Error {
  constructor(i, e) {
    super(i), this.offset = e;
  }
}
ee.DecodeWarning = yo;
function mo(t, i) {
  if (t.options.strictMode)
    throw i;
  t.warnings.push(i);
}
ee.handleWarning = mo;
var Oe = {}, ze = {}, Ji;
function vo() {
  if (Ji)
    return ze;
  Ji = 1, Object.defineProperty(ze, "__esModule", { value: !0 }), ze.ByteStreamReader = void 0;
  class t {
    constructor(e, r) {
      this.data = e, this._le = r, this.offset = 0, this.view = new DataView(e.buffer, e.byteOffset, e.byteLength);
    }
    readUint8() {
      return this.view.getUint8(this.offset++);
    }
    readUint16() {
      const e = this.view.getUint16(this.offset, this._le);
      return this.offset += 2, e;
    }
    readUint32() {
      const e = this.view.getUint32(this.offset, this._le);
      return this.offset += 4, e;
    }
  }
  return ze.ByteStreamReader = t, ze;
}
var De = {}, Qi;
function ko() {
  if (Qi)
    return De;
  Qi = 1, Object.defineProperty(De, "__esModule", { value: !0 }), De.readText = void 0;
  const t = ee;
  function i(e, r, n, a) {
    const l = [];
    let o = 0, c = 0;
    const s = e.reader.offset;
    for (; c < n; c++) {
      try {
        o = e.reader.view.getUint8(e.reader.offset);
      } catch (h) {
        throw h instanceof Error && h.message === "Offset is outside the bounds of the DataView" && (0, t.handleWarning)(e, new t.DecodeWarning("EOF while reading text", e.reader.offset)), h;
      }
      if (!a && o === 0)
        break;
      e.reader.offset++, l.push(o);
    }
    return e.reader.offset = s + n, r ? r.decode(new Uint8Array(l)) : String.fromCharCode(...l);
  }
  return De.readText = i, De;
}
var ie = {}, er;
function Eo() {
  if (er)
    return ie;
  er = 1, Object.defineProperty(ie, "__esModule", { value: !0 }), ie.isValidBitDepth = ie.isValidColorMapDepth = ie.isValidImageType = void 0;
  function t(r) {
    return r === 1 || r === 2 || r === 3 || r === 9 || r === 10 || r === 11;
  }
  ie.isValidImageType = t;
  function i(r) {
    return r === 15 || r === 16 || r === 24 || r === 32;
  }
  ie.isValidColorMapDepth = i;
  function e(r, n) {
    return n === 1 || n === 9 ? r === 8 : n === 3 || n === 11 ? r === 8 || r === 16 : r === 15 || r === 16 || r === 24 || r === 32;
  }
  return ie.isValidBitDepth = e, ie;
}
var tr;
function Co() {
  if (tr)
    return Oe;
  tr = 1, Object.defineProperty(Oe, "__esModule", { value: !0 }), Oe.decodeTga = void 0;
  const t = ee, i = vo(), e = ko(), r = Eo();
  async function n(f, d = {}) {
    var A, I;
    const w = {
      reader: new i.ByteStreamReader(f, !0),
      hasAlpha: !1,
      ambiguousAlpha: !1,
      options: d,
      warnings: []
    }, b = a(w), p = {
      ...w,
      header: b
    };
    p.identificationField = (0, e.readText)(p, void 0, p.header.idLength);
    const m = p.reader.offset;
    return p.footer = T(p), p.extensionArea = E(p), p.developerDirectory = N(p), p.reader.offset = m, ((A = p.header.colorMap) == null ? void 0 : A.type) === 1 && (p.colorMap = l(p, p.header.colorMap)), p.hasAlpha = p.colorMap && ((I = p.header.colorMap) == null ? void 0 : I.depth) === 32 || (p.header.attributeBitsPerPixel > 0 || p.header.bitDepth === 32) && (p.extensionArea === void 0 || p.extensionArea.attributesType > 2), p.ambiguousAlpha = p.hasAlpha && p.header.attributeBitsPerPixel === 0, p.image = o(p, p.reader.offset), {
      image: p.image,
      details: {
        header: p.header,
        imageId: p.identificationField,
        footer: p.footer,
        extensionArea: p.extensionArea,
        developerDirectory: p.developerDirectory
      },
      warnings: p.warnings
    };
  }
  Oe.decodeTga = n;
  function a(f) {
    const d = f.reader.readUint8(), w = f.reader.readUint8();
    let b;
    w === 0 || w === 1 ? b = w : ((0, t.handleWarning)(f, new t.DecodeWarning("Color map type unrecognized", f.reader.offset - 1)), b = 2);
    const p = f.reader.readUint8();
    if (!(0, r.isValidImageType)(p))
      throw new t.DecodeError(f, `Invalid image type "${p}"`, f.reader.offset - 1);
    b === 1 && p !== 1 && p !== 9 && (0, t.handleWarning)(f, new t.DecodeWarning(`Image type "${p}" cannot have a color map`, f.reader.offset - 2));
    const m = f.reader.readUint16(), A = f.reader.readUint16(), I = f.reader.readUint8();
    if (b === 1 && (m >= A && (0, t.handleWarning)(f, new t.DecodeWarning(`Color map origin "${m}" is greater than color map length "${A}"`, f.reader.offset - 5)), !(0, r.isValidColorMapDepth)(I)))
      throw new t.DecodeError(f, `Unsupported color map bit depth "${I}"`, f.reader.offset - 1);
    const M = f.reader.readUint16(), W = f.reader.readUint16(), Se = f.reader.readUint16(), it = f.reader.readUint16(), we = f.reader.readUint8();
    if (!(0, r.isValidBitDepth)(we, p))
      throw new t.DecodeError(f, `Unsupported TGA bit depth "${we}" with image type ${p}`, 16);
    const ye = f.reader.readUint8(), rt = (ye & 15) >> 0, Re = (ye & 48) >> 4;
    return {
      idLength: d,
      colorMap: b !== 0 ? {
        type: b,
        depth: I,
        length: A,
        origin: m
      } : void 0,
      imageType: p,
      origin: {
        x: M,
        y: W
      },
      width: Se,
      height: it,
      bitDepth: we,
      imageDescriptor: ye,
      attributeBitsPerPixel: rt,
      screenOrigin: Re
    };
  }
  function l(f, d) {
    const w = f.reader.offset, b = Math.ceil(d.depth / 8);
    f.reader.offset += d.length * b;
    let p;
    switch (d.depth) {
      case 15:
        p = _;
        break;
      case 16:
        f.hasAlpha ? p = u : p = _;
        break;
      case 24:
        p = v;
        break;
      case 32:
        p = $;
        break;
    }
    return (m, A, I, M) => {
      const W = I.getUint8(M);
      return p(m, A, f.reader.view, w + W * b), 1;
    };
  }
  function o(f, d) {
    const w = {
      width: f.header.width,
      height: f.header.height,
      data: new Uint8Array(f.header.width * f.header.height * 4)
    };
    let b;
    if (f.colorMap)
      b = f.colorMap;
    else
      switch (f.header.bitDepth) {
        case 8:
          b = s;
          break;
        case 15:
          b = _;
          break;
        case 16:
          f.header.imageType === 11 || f.header.imageType === 3 ? b = h : f.hasAlpha ? b = u : b = _;
          break;
        case 24:
          b = v;
          break;
        case 32:
          f.hasAlpha ? b = $ : b = C;
          break;
      }
    let p = f.reader.view;
    if (f.header.imageType & 8) {
      const m = c(f);
      p = new DataView(m.buffer, m.byteOffset, m.length), d = 0;
    }
    if (f.header.screenOrigin === 2) {
      let m = 0;
      for (let A = 0; A < w.height; A++)
        for (let I = 0; I < w.width; I++)
          d += b(w.data, m, p, d), m += 4;
    } else {
      let m = 0;
      for (let A = w.height - 1; A >= 0; A--) {
        m = f.header.width * A * 4;
        for (let I = 0; I < w.width; I++)
          d += b(w.data, m, p, d), m += 4;
      }
    }
    if (f.ambiguousAlpha && !f.options.strictMode && f.options.detectAmbiguousAlphaChannel) {
      let m = !1;
      for (let A = 3; A < w.width * w.height * 4; A += 4)
        w.data[A] > 0 && (m = !0);
      if (!m) {
        (0, t.handleWarning)(f, new t.DecodeWarning("Image has ambiguous alpha and is fully transparent, alpha has been disabled", -1));
        for (let A = 3; A < w.width * w.height * 4; A += 4)
          w.data[A] = 255;
      }
    }
    return w;
  }
  function c(f) {
    const d = Math.ceil(f.header.bitDepth / 8), w = new Uint8Array(f.header.width * f.header.height * d);
    let b = 0, p = 0, m = 0, A = 0, I = 0;
    for (; m < w.length - 1; )
      if (b = f.reader.readUint8(), p = (b & 127) + 1, b & 128) {
        for (A = 0; A < d; A++)
          for (b = f.reader.readUint8(), I = 0; I < p; I++)
            w[m + I * d + A] = b;
        m += p * d;
      } else {
        p *= d;
        for (let M = 0; M < p; M++)
          w[m++] = f.reader.readUint8();
      }
    return w;
  }
  function s(f, d, w, b) {
    return f[d] = w.getUint8(b), f[d + 1] = f[d], f[d + 2] = f[d], f[d + 3] = 255, 1;
  }
  function h(f, d, w, b) {
    return f[d] = w.getUint8(b), f[d + 1] = f[d], f[d + 2] = f[d], f[d + 3] = w.getUint8(b + 1), 2;
  }
  let g = 0;
  function _(f, d, w, b) {
    return g = w.getUint16(b, !0), f[d] = g >> 10 & 31, f[d + 1] = g >> 5 & 31, f[d + 2] = g & 31, f[d] = f[d] << 3 | f[d] >> 2, f[d + 1] = f[d + 1] << 3 | f[d + 1] >> 2, f[d + 2] = f[d + 2] << 3 | f[d + 2] >> 2, f[d + 3] = 255, 2;
  }
  function u(f, d, w, b) {
    return g = w.getUint16(b, !0), f[d] = g >> 10 & 31, f[d + 1] = g >> 5 & 31, f[d + 2] = g & 31, f[d] = f[d] << 3 | f[d] >> 2, f[d + 1] = f[d + 1] << 3 | f[d + 1] >> 2, f[d + 2] = f[d + 2] << 3 | f[d + 2] >> 2, f[d + 3] = g & 32768 ? 0 : 255, 2;
  }
  function v(f, d, w, b) {
    return f[d] = w.getUint8(b + 2), f[d + 1] = w.getUint8(b + 1), f[d + 2] = w.getUint8(b), f[d + 3] = 255, 3;
  }
  function $(f, d, w, b) {
    return f[d] = w.getUint8(b + 2), f[d + 1] = w.getUint8(b + 1), f[d + 2] = w.getUint8(b), f[d + 3] = w.getUint8(b + 3), 4;
  }
  function C(f, d, w, b) {
    return f[d] = w.getUint8(b + 2), f[d + 1] = w.getUint8(b + 1), f[d + 2] = w.getUint8(b), f[d + 3] = 255, 4;
  }
  function E(f) {
    var si;
    if (((si = f.footer) == null ? void 0 : si.extensionAreaOffset) === void 0 || f.footer.extensionAreaOffset === 0)
      return;
    f.reader.offset = f.footer.extensionAreaOffset;
    const d = f.reader.readUint16();
    d !== 495 && (0, t.handleWarning)(f, new t.DecodeWarning("TGA file is a version other than v2", f.reader.offset - 2));
    const w = (0, e.readText)(f, void 0, 41).trim() || void 0, b = (0, e.readText)(f, void 0, 324).trim() || void 0, p = x(f), m = (0, e.readText)(f, void 0, 41).trim() || void 0, A = y(f), I = (0, e.readText)(f, void 0, 41).trim() || void 0, M = f.reader.readUint8() / 100, W = (0, e.readText)(f, void 0, 2);
    let Se;
    M === 0 && (W === " " || W.length === 0) ? Se = void 0 : Se = `${M}${W}`;
    const it = f.reader.readUint8(), we = f.reader.readUint8(), ye = f.reader.readUint8(), rt = f.reader.readUint8();
    let Re;
    it === 0 && we === 0 && ye === 0 && rt === 0 ? Re = void 0 : Re = new Uint8Array([we, ye, rt, it]);
    const tn = f.reader.readUint16(), ni = f.reader.readUint16();
    let mt;
    ni === 0 ? mt = void 0 : mt = tn / ni;
    const rn = f.reader.readUint16(), ai = f.reader.readUint16();
    let vt;
    ai === 0 ? vt = void 0 : vt = rn / ai;
    const nn = f.reader.readUint32(), an = f.reader.readUint32(), sn = f.reader.readUint32(), on = f.reader.readUint8();
    return {
      extensionSize: d,
      authorName: w,
      authorComments: b,
      dateTimestamp: p,
      jobName: m,
      jobTime: A,
      softwareId: I,
      softwareVersion: Se,
      keyColor: Re,
      aspectRatio: mt,
      gamma: vt,
      colorCorrectionOffset: nn,
      postageStampOffset: an,
      scanLineOffset: sn,
      attributesType: on
    };
  }
  function N(f) {
    var b;
    if (((b = f.footer) == null ? void 0 : b.developerDirectoryOffset) === void 0 || f.footer.developerDirectoryOffset === 0)
      return [];
    f.reader.offset = f.footer.developerDirectoryOffset;
    const d = f.reader.readUint16(), w = [];
    for (let p = 0; p < d; p++) {
      const m = f.reader.readUint16(), A = f.reader.readUint32(), I = f.reader.readUint32();
      w.push({ tag: m, offset: A, length: I });
    }
    return w;
  }
  function x(f) {
    const d = f.reader.readUint16(), w = f.reader.readUint16(), b = f.reader.readUint16(), p = f.reader.readUint16(), m = f.reader.readUint16(), A = f.reader.readUint16();
    if (!(d === 0 && w === 0 && b === 0 && p === 0 && m === 0 && A === 0))
      return new Date(b, d, w, p, m, A);
  }
  function y(f) {
    const d = f.reader.readUint16(), w = f.reader.readUint16(), b = f.reader.readUint16();
    if (!(d === 0 && w === 0 && b === 0))
      return { hours: d, minutes: w, seconds: b };
  }
  function T(f) {
    if (f.reader.offset = f.reader.view.byteLength - 26 + 8, (0, e.readText)(f, void 0, 17) !== "TRUEVISION-XFILE." || f.reader.readUint8() !== 0)
      return {
        extensionAreaOffset: 0,
        developerDirectoryOffset: 0
      };
    f.reader.offset = f.reader.view.byteLength - 26;
    let w = f.reader.readUint32();
    w >= f.reader.view.byteLength && ((0, t.handleWarning)(f, new t.DecodeWarning(`Extension area offset "${w}" is invalid`, f.reader.offset - 4)), w = 0);
    let b = f.reader.readUint32();
    return b >= f.reader.view.byteLength && ((0, t.handleWarning)(f, new t.DecodeWarning(`Developer directory offset "${b}" is invalid`, f.reader.offset - 4)), b = 0), {
      extensionAreaOffset: w,
      developerDirectoryOffset: b
    };
  }
  return Oe;
}
(function(t) {
  Object.defineProperty(t, "__esModule", { value: !0 }), t.decodeTga = t.DecodeWarning = t.DecodeError = void 0;
  var i = ee;
  Object.defineProperty(t, "DecodeError", { enumerable: !0, get: function() {
    return i.DecodeError;
  } }), Object.defineProperty(t, "DecodeWarning", { enumerable: !0, get: function() {
    return i.DecodeWarning;
  } });
  async function e(r, n) {
    return (await Promise.resolve().then(() => Co())).decodeTga(r, n);
  }
  t.decodeTga = e;
})(Jr);
async function Qr(t) {
  const e = await (await fetch(t)).arrayBuffer();
  return new Uint8Array(e);
}
async function en(t) {
  const i = new Z().uint32("payloadLength").uint8("type").array("data", { type: "uint8", length: "payloadLength" });
  let r = new Z().string("magic", { length: 8, assert: "TRNSRTS\0" }).uint32("payloadLength").string("payload", { length: "payloadLength" }).string("magic", { length: 8, assert: "TEX_SECT" }).uint32("textureCount").array("textures", { type: i, length: "textureCount" }).parse(t), n = new Array(0);
  return r.textures.forEach((a) => {
    let l = a.type, o = new Uint8Array(a.data);
    switch (l) {
      case 0:
        n.push(
          new Promise((c, s) => {
            let h = go(o), g = new S.DataTexture(h.data, h.width, h.height);
            g.generateMipmaps = !0, g.needsUpdate = !0, c(g);
          })
        );
        break;
      case 1:
        n.push(
          new Promise(async (c, s) => {
            Jr.decodeTga(o, { detectAmbiguousAlphaChannel: !0 }).then((h) => {
              let g = new S.DataTexture(h.image.data, h.image.width, h.image.height);
              g.generateMipmaps = !0, g.needsUpdate = !0, c(g);
            }).catch((h) => {
              s(h);
            });
          })
        );
        break;
      default:
        throw "Could not decode texture data";
    }
  }), (async () => {
    let a = await Promise.all(n), l = _r(JSON.parse(r.payload), a);
    return l.textures = Array.from(a), l;
  })();
}
async function Ao(t) {
  return await en(await Qr(t));
}
const Ro = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  downloadFile: Qr,
  inImport: en,
  inImportFromURL: Ao
}, Symbol.toStringTag, { value: "Module" }));
export {
  Ro as INP,
  Uo as Puppet,
  No as Renderer
};
