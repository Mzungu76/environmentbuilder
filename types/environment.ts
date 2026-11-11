import type { NavigationGraph } from './navigation';
import type { InteractiveObject, Entrance, Exit } from './interaction';
import type { Character } from './character';

export type LayerRole = 'background' | 'midground' | 'foreground';

export interface SceneLayer {
  id: string;
  name: string;
  role: LayerRole;
  assetId: string;
  visible: boolean;
  /** Offset, normalized to the environment size. */
  offsetX: number;
  offsetY: number;
  opacity: number;
}

/** Metadata of an imported image asset. The binary lives in IndexedDB / the ZIP archive. */
export interface ImageAssetMeta {
  id: string;
  fileName: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export type ProfileId = 'cave' | 'forest' | 'building' | 'ship' | 'industrial' | 'outdoor' | 'custom';

export interface Environment {
  id: string;
  name: string;
  /** Original pixel size of the main background. All normalized coordinates refer to it. */
  width: number;
  height: number;
  profiles: ProfileId[];
  /** Order = draw order (back to front) within each role; roles are drawn background → midground → foreground. */
  layers: SceneLayer[];
  assets: ImageAssetMeta[];
  navigation: NavigationGraph;
  objects: InteractiveObject[];
  entrances: Entrance[];
  exits: Exit[];
  characters: Character[];
}
