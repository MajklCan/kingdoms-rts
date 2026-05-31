/**
 * Shared AoE2-style voxel palette. All Dark Age models pull from this so
 * stone/wood/roof tones match across buildings and don't read as inconsistent.
 */

export const PALETTE = {
  // Sandstone (warm — never gray)
  STONE_L: 0xd4c096,
  STONE_M: 0xb89e74,
  STONE_D: 0x86694a,
  STONE_BASE: 0x6f5c44,

  // Wood
  WOOD_L: 0xa07442,
  WOOD_M: 0x6f4a26,
  WOOD_D: 0x4a3018,
  WOOD_DOOR: 0x3a2410,

  // Terracotta roof tiles
  ROOF_L: 0xd05a40,
  ROOF_M: 0xa83b25,
  ROOF_D: 0x751a18,
  ROOF_RIDGE: 0x4f1014,

  // Thatch (lighter, used on smaller buildings)
  THATCH_L: 0xd9b76e,
  THATCH_M: 0xa68850,
  THATCH_D: 0x6e562e,

  // Detail
  IRON: 0x2c2418,
  GOLD: 0xc89c2c,
  STEEL: 0x9aa0a8,

  // Ground / terrain
  GRASS_L: 0x6a8c40,
  GRASS_M: 0x547034,
  GRASS_D: 0x3e5828,
  DIRT_L: 0x9c7848,
  DIRT_M: 0x7e5a32,
  DIRT_D: 0x563c20,
  SAND_L: 0xe6cf94,
  SAND_M: 0xc4ab70,
  SAND_D: 0xa08c54,
  SNOW_L: 0xf4fbff,
  SNOW_M: 0xdcecf4,
  SNOW_D: 0xb7c9d3,
  SNOW_SHADOW: 0x8ea8b8,
  ICE_L: 0xbde8f0,
  ICE_M: 0x83bfd4,
  ICE_D: 0x4c8096,
  WATER_L: 0x4c8cb4,
  WATER_M: 0x346e98,
  WATER_D: 0x1f4870,
  WATER_FOAM: 0xa8d4e0,

  // Resources
  TREE_TRUNK_L: 0x6f4a26,
  TREE_TRUNK_D: 0x4a2e16,
  TREE_CANOPY_L: 0x4c8836,
  TREE_CANOPY_M: 0x356220,
  TREE_CANOPY_D: 0x254416,
  GOLD_ORE: 0xe8b923,
  GOLD_ORE_D: 0x9c7a18,
  STONE_ORE_L: 0xb0aea4,
  STONE_ORE_M: 0x8c8a82,
  STONE_ORE_D: 0x5c5a52,
  BERRY: 0xc02038,
  BERRY_D: 0x801020,

  // Unit colours
  SKIN: 0xe0b088,
  SKIN_D: 0xa07858,
  HAIR_BROWN: 0x6c4424,
  TUNIC_BROWN: 0x8a6638,
  TUNIC_GREEN: 0x4c6e34,
  TUNIC_RED: 0x8c342c,
  LEATHER: 0x7a4a2a,
  LEATHER_D: 0x4a2818,
  HORSE_BAY: 0x7b4a2a,
  HORSE_DARK: 0x4a2c1a,
  MANE: 0x2e1c12,
  BOW_WOOD: 0x8a5a2c,
  ARROW_SHAFT: 0xc4a06a,
  FLETCHING: 0xe8dcc0,
  MAIL: 0x8c8a90,
  MAIL_D: 0x60606a,
  BOOTS: 0x3a2410,
  SWORD_BLADE: 0xc0c4d0,
  SWORD_HILT: 0x4a3018,
  SHIELD_WOOD: 0x6f4a26,
} as const;
