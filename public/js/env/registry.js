import { VoidEnvironment } from './void.js';
import { BunkerEnvironment } from './bunker.js';
import { CabEnvironment } from './cab.js';

/**
 * Order matters — this is the cycle order on the controller's A button.
 * Starting in the void because it is the cheapest to render, which makes it
 * the safest thing to be looking at while the WebRTC stream negotiates.
 */
export const ENVIRONMENTS = [VoidEnvironment, BunkerEnvironment, CabEnvironment];

export function createEnvironment(id) {
  const Cls = ENVIRONMENTS.find((e) => e.id === id) || ENVIRONMENTS[0];
  return new Cls();
}

export function nextEnvironmentId(current) {
  const i = ENVIRONMENTS.findIndex((e) => e.id === current);
  return ENVIRONMENTS[(i + 1) % ENVIRONMENTS.length].id;
}
