// Type-only barrel: `export type *` guarantees nothing here survives compilation,
// so importing this package never adds runtime code to the API or the portals.
export type * from './appointments';
export type * from './auth';
export type * from './domain';
export type * from './errors';
export type * from './faculty';
export type * from './health';
