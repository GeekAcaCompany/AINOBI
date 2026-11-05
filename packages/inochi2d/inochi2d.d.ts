import type { Object3D, Texture } from "three";

export type InochiRootNode = {
  create(): void;
  update(): void;
  children: InochiRootNode[];
  threeObj: Object3D;
};

export const INP: {
  inImportFromURL(url: string): Promise<{
    meta: { name?: string };
    rootNode: InochiRootNode;
    textures: Texture[];
  }>;
};
