// Parametric catalog of standard home items. All geometry is procedural (generated in code),
// so there are no third-party model files or licenses involved. Sizes are common US standards.
const IN = 0.0254, FT = 0.3048;
export type Footprint = 'rect' | 'circle';
export interface CatItem { key: string; cat: string; name: string; w: number; d: number; h: number; elev?: number; color: string; shape: string; fp?: Footprint; finish?: string; wallAlign?: boolean; ceiling?: boolean; icon: string }
export interface OpeningItem { key: string; cat: string; name: string; kind: 'door' | 'window' | 'opening' | 'slider'; style: string; width: number; height: number; sill: number; icon: string }

const i = (n: number) => n * IN, f = (n: number) => n * FT;
const C = (key: string, cat: string, name: string, w: number, d: number, h: number, color: string, shape: string, icon: string, extra: Partial<CatItem> = {}): CatItem => ({ key, cat, name, w, d, h, color, shape, icon, ...extra });

export const OPENINGS: OpeningItem[] = [
  { key: 'door-int', cat: 'Doors', name: 'Interior door 32"', kind: 'door', style: 'interior', width: i(32), height: i(80), sill: 0, icon: '🚪' },
  { key: 'door-int30', cat: 'Doors', name: 'Interior door 30"', kind: 'door', style: 'interior', width: i(30), height: i(80), sill: 0, icon: '🚪' },
  { key: 'door-ext', cat: 'Doors', name: 'Exterior entry door 36"', kind: 'door', style: 'exterior', width: i(36), height: i(80), sill: 0, icon: '🚪' },
  { key: 'door-french', cat: 'Doors', name: 'French doors 60"', kind: 'door', style: 'french', width: i(60), height: i(80), sill: 0, icon: '🚪' },
  { key: 'door-pocket', cat: 'Doors', name: 'Pocket door 30"', kind: 'door', style: 'pocket', width: i(30), height: i(80), sill: 0, icon: '🚪' },
  { key: 'door-bifold', cat: 'Doors', name: 'Bifold closet 48"', kind: 'door', style: 'bifold', width: i(48), height: i(80), sill: 0, icon: '🚪' },
  { key: 'door-slider6', cat: 'Doors', name: 'Sliding glass door 6\'', kind: 'slider', style: 'slider', width: i(72), height: i(80), sill: 0, icon: '🪟' },
  { key: 'door-slider8', cat: 'Doors', name: 'Sliding glass door 8\'', kind: 'slider', style: 'slider', width: i(96), height: i(96), sill: 0, icon: '🪟' },
  { key: 'door-garage1', cat: 'Doors', name: 'Garage door 9\'x7\'', kind: 'door', style: 'garage', width: f(9), height: f(7), sill: 0, icon: '🚗' },
  { key: 'door-garage2', cat: 'Doors', name: 'Garage door 16\'x7\'', kind: 'door', style: 'garage', width: f(16), height: f(7), sill: 0, icon: '🚗' },
  { key: 'opening', cat: 'Doors', name: 'Cased opening 36"', kind: 'opening', style: 'opening', width: i(36), height: i(80), sill: 0, icon: '▯' },
  { key: 'win-sh', cat: 'Windows', name: 'Single-hung 36x48', kind: 'window', style: 'single-hung', width: i(36), height: i(48), sill: i(36), icon: '🪟' },
  { key: 'win-sh-s', cat: 'Windows', name: 'Single-hung 24x36', kind: 'window', style: 'single-hung', width: i(24), height: i(36), sill: i(44), icon: '🪟' },
  { key: 'win-slide', cat: 'Windows', name: 'Horizontal slider 48x36', kind: 'window', style: 'slider', width: i(48), height: i(36), sill: i(44), icon: '🪟' },
  { key: 'win-pic', cat: 'Windows', name: 'Picture window 72x48', kind: 'window', style: 'picture', width: i(72), height: i(48), sill: i(30), icon: '🖼️' },
  { key: 'win-bay', cat: 'Windows', name: 'Bay window 96x54', kind: 'window', style: 'bay', width: i(96), height: i(54), sill: i(24), icon: '🪟' },
  { key: 'win-bath', cat: 'Windows', name: 'Bathroom (obscure) 24x24', kind: 'window', style: 'picture', width: i(24), height: i(24), sill: i(60), icon: '🪟' },
];

export const CATALOG: CatItem[] = [
  // Kitchen
  C('base', 'Kitchen', 'Base cabinet 36"', i(36), i(24), i(36), '#e8e2d6', 'baseCab', '🗄️', { wallAlign: true }),
  C('base24', 'Kitchen', 'Base cabinet 24"', i(24), i(24), i(36), '#e8e2d6', 'baseCab', '🗄️', { wallAlign: true }),
  C('base18', 'Kitchen', 'Base cabinet 18"', i(18), i(24), i(36), '#e8e2d6', 'baseCab', '🗄️', { wallAlign: true }),
  C('sinkbase', 'Kitchen', 'Sink base 36"', i(36), i(24), i(36), '#e8e2d6', 'sinkCab', '🚰', { wallAlign: true }),
  C('upper', 'Kitchen', 'Upper cabinet 30"', i(30), i(12), i(30), '#e8e2d6', 'upperCab', '🗄️', { elev: i(54), wallAlign: true }),
  C('upper36', 'Kitchen', 'Upper cabinet 36"x42"', i(36), i(12), i(42), '#e8e2d6', 'upperCab', '🗄️', { elev: i(54), wallAlign: true }),
  C('tall', 'Kitchen', 'Tall pantry 24"x84"', i(24), i(24), i(84), '#e8e2d6', 'tallCab', '🗄️', { wallAlign: true }),
  C('counter', 'Kitchen', 'Countertop 8\'', f(8), i(25.5), i(1.5), '#d8d4cc', 'slab', '▬', { elev: i(34.5), finish: 'stone', wallAlign: true }),
  C('island', 'Kitchen', 'Island 6\'x3\'', i(72), i(36), i(36), '#5b6b7a', 'island', '🏝️'),
  C('island8', 'Kitchen', 'Island w/ seating 8\'x4\'', i(96), i(48), i(36), '#5b6b7a', 'island', '🏝️'),
  C('fridge', 'Kitchen', 'Refrigerator 36"', i(36), i(30), i(70), '#c9ccd0', 'fridge', '🧊', { finish: 'metal', wallAlign: true }),
  C('range', 'Kitchen', 'Range 30"', i(30), i(26), i(36), '#3a3d42', 'range', '🔥', { finish: 'metal', wallAlign: true }),
  C('dishwasher', 'Kitchen', 'Dishwasher 24"', i(24), i(24), i(34), '#c9ccd0', 'appliance', '🍽️', { finish: 'metal', wallAlign: true }),
  C('microwave', 'Kitchen', 'OTR microwave 30"', i(30), i(16), i(17), '#c9ccd0', 'appliance', '📦', { elev: i(66), finish: 'metal', wallAlign: true }),
  C('hood', 'Kitchen', 'Range hood 30"', i(30), i(20), i(10), '#b8bcc2', 'appliance', '🌀', { elev: i(60), finish: 'metal', wallAlign: true }),
  // Laundry & utility
  C('washer', 'Laundry & utility', 'Washer', i(27), i(30), i(39), '#f2f2f2', 'washer', '🫧', { wallAlign: true }),
  C('dryer', 'Laundry & utility', 'Dryer', i(27), i(30), i(39), '#f2f2f2', 'washer', '🫧', { wallAlign: true }),
  C('wh-tank', 'Laundry & utility', 'Water heater 50 gal', i(22), i(22), i(60), '#e9e9e4', 'cylinder', '🛢️', { fp: 'circle' }),
  C('wh-tankless', 'Laundry & utility', 'Tankless water heater', i(18), i(8), i(28), '#f2f2f2', 'appliance', '♨️', { elev: i(48), wallAlign: true }),
  C('ahu', 'Laundry & utility', 'Air handler', i(22), i(22), i(52), '#d8d8d4', 'appliance', '❄️'),
  C('panel', 'Laundry & utility', 'Electric panel', i(14), i(4), i(30), '#9aa0a6', 'appliance', '⚡', { elev: i(48), wallAlign: true }),
  // Bathroom
  C('toilet', 'Bathroom', 'Toilet', i(19), i(28), i(30), '#ffffff', 'toilet', '🚽', { wallAlign: true, finish: 'gloss' }),
  C('vanity30', 'Bathroom', 'Vanity 30"', i(30), i(21), i(34), '#f0ece4', 'vanity', '🚰', { wallAlign: true }),
  C('vanity48', 'Bathroom', 'Vanity 48"', i(48), i(21), i(34), '#f0ece4', 'vanity', '🚰', { wallAlign: true }),
  C('vanity60', 'Bathroom', 'Double vanity 60"', i(60), i(21), i(34), '#f0ece4', 'vanity', '🚰', { wallAlign: true }),
  C('tub', 'Bathroom', 'Bathtub 60x30', i(60), i(30), i(20), '#ffffff', 'tub', '🛁', { wallAlign: true, finish: 'gloss' }),
  C('tub-free', 'Bathroom', 'Freestanding tub', i(66), i(32), i(24), '#ffffff', 'tub', '🛁', { finish: 'gloss' }),
  C('shower', 'Bathroom', 'Shower pan 48x36', i(48), i(36), i(4), '#dfe6ea', 'slab', '🚿', { wallAlign: true }),
  C('shower60', 'Bathroom', 'Walk-in shower 60x36', i(60), i(36), i(4), '#dfe6ea', 'slab', '🚿', { wallAlign: true }),
  C('glass', 'Bathroom', 'Glass shower enclosure', i(48), i(2), i(76), '#bfe0f0', 'glassPanel', '🪟', { finish: 'glass' }),
  C('mirror', 'Bathroom', 'Mirror 36x30', i(36), i(1), i(30), '#cfe3ec', 'glassPanel', '🪞', { elev: i(40), finish: 'glass', wallAlign: true }),
  // Bedroom & living
  C('bed-k', 'Furniture', 'King bed', i(76), i(80), i(24), '#9fb3c8', 'bed', '🛏️', { wallAlign: true }),
  C('bed-q', 'Furniture', 'Queen bed', i(60), i(80), i(24), '#9fb3c8', 'bed', '🛏️', { wallAlign: true }),
  C('bed-f', 'Furniture', 'Full bed', i(54), i(75), i(24), '#9fb3c8', 'bed', '🛏️', { wallAlign: true }),
  C('bed-t', 'Furniture', 'Twin bed', i(38), i(75), i(24), '#9fb3c8', 'bed', '🛏️', { wallAlign: true }),
  C('nightstand', 'Furniture', 'Nightstand', i(22), i(18), i(26), '#8a6a4a', 'dresser', '🗄️', { finish: 'wood' }),
  C('dresser', 'Furniture', 'Dresser', i(60), i(20), i(32), '#8a6a4a', 'dresser', '🗄️', { finish: 'wood', wallAlign: true }),
  C('sofa', 'Furniture', 'Sofa 7\'', i(84), i(36), i(32), '#7d8c7a', 'sofa', '🛋️', { wallAlign: true }),
  C('sectional', 'Furniture', 'Sectional', i(110), i(84), i(32), '#7d8c7a', 'sectional', '🛋️'),
  C('loveseat', 'Furniture', 'Loveseat', i(60), i(36), i(32), '#7d8c7a', 'sofa', '🛋️'),
  C('chair-arm', 'Furniture', 'Armchair', i(34), i(34), i(32), '#7d8c7a', 'sofa', '💺'),
  C('table-din', 'Furniture', 'Dining table 6\'', i(72), i(40), i(30), '#8a6a4a', 'table', '🍽️', { finish: 'wood' }),
  C('table-rnd', 'Furniture', 'Round table 48"', i(48), i(48), i(30), '#8a6a4a', 'roundTable', '⚪', { fp: 'circle', finish: 'wood' }),
  C('chair', 'Furniture', 'Dining chair', i(18), i(20), i(36), '#6b5038', 'chair', '🪑', { finish: 'wood' }),
  C('coffee', 'Furniture', 'Coffee table', i(48), i(24), i(18), '#8a6a4a', 'table', '▭', { finish: 'wood' }),
  C('desk', 'Furniture', 'Desk', i(60), i(30), i(30), '#8a6a4a', 'table', '🖥️', { finish: 'wood' }),
  C('tv', 'Furniture', 'TV 65" + console', i(60), i(18), i(24), '#2b2b2b', 'tvConsole', '📺', { wallAlign: true }),
  // Structure
  C('stairs', 'Structure', 'Straight stairs 3\'x10\'', i(36), f(10), f(9), '#cfc6b8', 'stairs', '🪜'),
  C('stairs-ext', 'Structure', 'Entry steps (3)', i(48), i(33), i(21), '#bdbdb6', 'stairs', '🪜', { finish: 'stone' }),
  C('column', 'Structure', 'Column 12"', i(12), i(12), f(9), '#eeeeee', 'box', '▮'),
  C('column-rnd', 'Structure', 'Round column 10"', i(10), i(10), f(9), '#eeeeee', 'cylinder', '⚪', { fp: 'circle' }),
  C('beam', 'Structure', 'Beam', f(12), i(6), i(12), '#c8b49a', 'box', '▬', { elev: f(8), finish: 'wood' }),
  C('step', 'Structure', 'Step / platform', i(48), i(12), i(7), '#cfc6b8', 'box', '▭'),
  C('closet', 'Structure', 'Closet rod + shelf 6\'', f(6), i(14), i(12), '#f2efe8', 'closet', '👔', { elev: i(66), wallAlign: true }),
  C('shelving', 'Structure', 'Shelving unit', i(36), i(16), i(72), '#f2efe8', 'shelving', '📚', { wallAlign: true }),
  C('fireplace', 'Structure', 'Fireplace', i(60), i(20), i(48), '#8d8a84', 'fireplace', '🔥', { wallAlign: true, finish: 'stone' }),
  C('box', 'Structure', 'Generic box', i(24), i(24), i(24), '#d0b48c', 'box', '📦'),
  // Lighting
  C('can', 'Lighting', 'Recessed light', i(6), i(6), i(1), '#fffbe6', 'canLight', '💡', { fp: 'circle', ceiling: true }),
  C('fan', 'Lighting', 'Ceiling fan 52"', i(52), i(52), i(12), '#7a5a3a', 'fan', '🌀', { fp: 'circle', ceiling: true }),
  C('pendant', 'Lighting', 'Pendant light', i(14), i(14), i(30), '#222222', 'pendant', '💡', { fp: 'circle', ceiling: true }),
  C('chandelier', 'Lighting', 'Chandelier', i(28), i(28), i(30), '#c9a85a', 'pendant', '✨', { fp: 'circle', ceiling: true, finish: 'metal' }),
  C('sconce', 'Lighting', 'Wall sconce', i(8), i(6), i(12), '#c9a85a', 'appliance', '💡', { elev: i(66), wallAlign: true }),
  // Outdoor - pool
  C('pool-rect', 'Pool & patio', 'Pool 14x28 rectangle', f(14), f(28), i(6), '#3e9fd6', 'poolRect', '🏊'),
  C('pool-12x24', 'Pool & patio', 'Pool 12x24 rectangle', f(12), f(24), i(6), '#3e9fd6', 'poolRect', '🏊'),
  C('pool-oval', 'Pool & patio', 'Pool oval / kidney 15x30', f(15), f(30), i(6), '#3e9fd6', 'poolOval', '🏊', { fp: 'circle' }),
  C('spa', 'Pool & patio', 'Spa 8\' round', f(8), f(8), i(18), '#3e9fd6', 'spa', '♨️', { fp: 'circle' }),
  C('cage', 'Pool & patio', 'Screen cage 30x40', f(30), f(40), f(12), '#e8e8e8', 'cage', '🏠'),
  C('pavers', 'Pool & patio', 'Paver patio 12x16', f(12), f(16), i(2.5), '#c19a7a', 'slab', '🧱', { finish: 'stone' }),
  C('slab', 'Pool & patio', 'Concrete slab 10x10', f(10), f(10), i(4), '#b7b5ae', 'slab', '⬜', { finish: 'stone' }),
  C('lanai', 'Pool & patio', 'Covered lanai 12x20', f(20), f(12), f(9), '#f0ede6', 'pergolaSolid', '⛱️'),
  C('pergola', 'Pool & patio', 'Pergola 12x12', f(12), f(12), f(9), '#9a7b5a', 'pergola', '⛩️', { finish: 'wood' }),
  C('deck', 'Pool & patio', 'Wood deck 12x16', f(16), f(12), i(18), '#9a7350', 'deck', '🪵', { finish: 'wood' }),
  C('okitchen', 'Pool & patio', 'Outdoor kitchen 10\'', f(10), i(30), i(36), '#8d8a84', 'island', '🍖', { finish: 'stone' }),
  C('grill', 'Pool & patio', 'Grill', i(60), i(24), i(46), '#555555', 'grill', '🍖', { finish: 'metal' }),
  C('lounger', 'Pool & patio', 'Pool lounger', i(26), i(76), i(14), '#f5f5f5', 'lounger', '🏖️'),
  C('umbrella', 'Pool & patio', 'Umbrella 9\'', f(9), f(9), f(8), '#e8d8b8', 'umbrella', '⛱️', { fp: 'circle' }),
  // Site
  C('driveway', 'Site & hardscape', 'Driveway 20x24', f(20), f(24), i(4), '#bdbbb4', 'slab', '🚗', { finish: 'stone' }),
  C('walkway', 'Site & hardscape', 'Walkway 4x20', f(4), f(20), i(4), '#c9b9a5', 'slab', '🚶', { finish: 'stone' }),
  C('fence', 'Site & hardscape', 'Privacy fence 8\' panel', f(8), i(4), f(6), '#f2f2ee', 'fence', '🚧'),
  C('fence-alum', 'Site & hardscape', 'Aluminum fence 6\' panel', f(6), i(2), f(4), '#222222', 'fenceRail', '🚧', { finish: 'metal' }),
  C('gate', 'Site & hardscape', 'Gate 4\'', f(4), i(4), f(6), '#e8e8e2', 'fence', '🚪'),
  C('dock', 'Site & hardscape', 'Dock 6x30', f(6), f(30), i(30), '#9a7350', 'dock', '⚓', { finish: 'wood' }),
  C('seawall', 'Site & hardscape', 'Seawall 40\'', f(40), i(12), f(3), '#b5b3ab', 'box', '🌊', { finish: 'stone' }),
  C('shed', 'Site & hardscape', 'Shed 8x10', f(10), f(8), f(9), '#c8b49a', 'shed', '🛖'),
  C('ac', 'Site & hardscape', 'AC condenser', i(30), i(30), i(34), '#d9d9d4', 'acUnit', '❄️', { finish: 'metal' }),
  C('generator', 'Site & hardscape', 'Standby generator', i(48), i(25), i(29), '#c9c9c0', 'appliance', '⚡', { finish: 'metal' }),
  C('pad', 'Site & hardscape', 'Equipment pad 3x5', f(5), f(3), i(4), '#b7b5ae', 'slab', '⬜'),
  C('mailbox', 'Site & hardscape', 'Mailbox', i(8), i(20), i(48), '#333333', 'mailbox', '📫'),
  C('postlight', 'Site & hardscape', 'Post / landscape light', i(8), i(8), f(7), '#222222', 'postLight', '🏮', { fp: 'circle' }),
  C('car', 'Site & hardscape', 'Car (for scale)', i(72), i(185), i(58), '#8a99a8', 'car', '🚙'),
  // Landscape
  C('palm', 'Landscape', 'Palm tree', f(10), f(10), f(18), '#5f8f3e', 'palm', '🌴', { fp: 'circle' }),
  C('palm-s', 'Landscape', 'Small palm', f(6), f(6), f(9), '#5f8f3e', 'palm', '🌴', { fp: 'circle' }),
  C('tree', 'Landscape', 'Shade tree', f(16), f(16), f(22), '#4f7f36', 'tree', '🌳', { fp: 'circle' }),
  C('shrub', 'Landscape', 'Shrub', f(3), f(3), f(3), '#4f8a3a', 'shrub', '🌿', { fp: 'circle' }),
  C('hedge', 'Landscape', 'Hedge 10\'', f(10), f(2.5), f(4), '#4f8a3a', 'box', '🌿'),
  C('sod', 'Landscape', 'Grass / sod 20x20', f(20), f(20), i(1), '#6e9b4f', 'slab', '🟩'),
  C('mulch', 'Landscape', 'Mulch bed 4x12', f(12), f(4), i(3), '#6b4a32', 'slab', '🟫'),
  C('rock', 'Landscape', 'Rock bed 4x12', f(12), f(4), i(3), '#c8c3b8', 'slab', '⬜', { finish: 'stone' }),
];

export const CAT_BY_KEY: Record<string, CatItem> = Object.fromEntries(CATALOG.map(c => [c.key, c]));
export const OPENING_BY_KEY: Record<string, OpeningItem> = Object.fromEntries(OPENINGS.map(c => [c.key, c]));
export const CATEGORIES = ['Doors', 'Windows', ...Array.from(new Set(CATALOG.map(c => c.cat)))];

export const FINISHES: Record<string, { label: string; rough: number; metal: number; opacity?: number }> = {
  matte: { label: 'Matte / paint', rough: 0.9, metal: 0 },
  satin: { label: 'Satin', rough: 0.55, metal: 0 },
  gloss: { label: 'Gloss', rough: 0.2, metal: 0 },
  wood: { label: 'Wood', rough: 0.7, metal: 0 },
  stone: { label: 'Stone / concrete', rough: 0.95, metal: 0 },
  metal: { label: 'Stainless / metal', rough: 0.35, metal: 0.8 },
  glass: { label: 'Glass', rough: 0.05, metal: 0, opacity: 0.35 },
};

/** Common paint colors (generic names; approximate) and cabinet/material colors. */
export const PAINTS: { name: string; hex: string }[] = [
  { name: 'Pure white', hex: '#f4f3ee' }, { name: 'Alabaster', hex: '#ede6d6' }, { name: 'Agreeable gray', hex: '#d1cbc1' }, { name: 'Repose gray', hex: '#c2bdb2' },
  { name: 'Accessible beige', hex: '#d1c7b8' }, { name: 'Sea salt', hex: '#cdd3c7' }, { name: 'Pale oak', hex: '#ddd4c6' }, { name: 'Revere pewter', hex: '#ccc5b6' },
  { name: 'Coastal blue', hex: '#8fb3c9' }, { name: 'Sage green', hex: '#a3ad94' }, { name: 'Hale navy', hex: '#3d4855' }, { name: 'Tricorn black', hex: '#2b2b2b' },
  { name: 'Iron ore', hex: '#434341' }, { name: 'Terracotta', hex: '#c06a4b' }, { name: 'Butter yellow', hex: '#f1dc9b' }, { name: 'Blush', hex: '#e7c9bf' },
  { name: 'Oak', hex: '#b98a5a' }, { name: 'Walnut', hex: '#6b4a32' }, { name: 'Espresso', hex: '#3e2c22' }, { name: 'Stainless', hex: '#c9ccd0' },
];
