import type { PieceJson } from '../piece.js';
import hanji from './hanji-light.json';
import semachi from './semachi-rain.json';
import hwimori from './hwimori-lanterns.json';

/** The three authored v1 pieces, in menu order. */
export const PIECES: readonly PieceJson[] = [hanji as PieceJson, semachi as PieceJson, hwimori as PieceJson];
