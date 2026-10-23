import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string => `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  'wrist-menu': { url: publicAssetUrl('ui/wrist-menu.uikitml'), type: AssetType.UIKitML, name: 'Wrist Menu' },
});
