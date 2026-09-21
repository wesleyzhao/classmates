// Type shim for the vendored copy of htm: only `bind` is used, as in `htm.bind(h)`.
declare const htm: {
  bind<H extends (type: any, props: any, ...children: any[]) => any>(h: H): (strings: TemplateStringsArray, ...values: any[]) => ReturnType<H> | ReturnType<H>[];
};
export default htm;
