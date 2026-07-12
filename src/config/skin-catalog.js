export const RANDOM_SKIN_DROP_OFFERING_NAME = 'Random Coin Skin Drop';
export const RANDOM_SKIN_DROP_TRIGGER_KEY = 'coin_pusher.random_skin_drop';

export const COIN_SKINS = Object.freeze([
  {
    id: 'yes_drop.bulldog',
    name: 'Bulldog',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783626254/Bull_Dog_rtrjjp.png',
  },
  {
    id: 'yes_drop.sand_dollar',
    name: 'Sand Dollar',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783624871/sand_doller_ksslmy.png',
  },
  {
    id: 'yes_drop.cucumber_slice',
    name: 'Cucumber Slice',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783625069/cucumber_slice_ksx4je.png',
  },
  {
    id: 'yes_drop.smiley_face',
    name: 'Smiley Face',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783625578/smiley_face_psoicx.png',
  },
  {
    id: 'yes_drop.christmas_tree',
    name: 'Christmas Tree',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783625712/Christmas_tree_fxhhru.png',
  },
  {
    id: 'yes_drop.fairy_godmother',
    name: 'Fairy Godmother',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783626474/Fairy_God_Mother_srgg3s.png',
  },
  {
    id: 'yes_drop.ghost',
    name: 'Ghost',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783625826/ghost_t5yq03.png',
  },
  {
    id: 'yes_drop.skull_and_bones',
    name: 'Skull and Bones',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783625930/Skull_and_Bones_aqkls6.png',
  },
  {
    id: 'yes_drop.cupid',
    name: 'Cupid',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783626043/Cupid_kjxcfu.png',
  },
  {
    id: 'yes_drop.chocolate',
    name: 'Chocolate',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783626683/CHocalate_rfhkqa.png',
  },
  {
    id: 'yes_drop.disco_ball',
    name: 'Disco Ball',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783626923/Disco_Ball_viiz2e.png',
  },
  {
    id: 'yes_drop.pizza_slice',
    name: 'Pizza Slice',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783627049/Pizza_Slice_lwey9c.png',
  },
  {
    id: 'yes_drop.gumball',
    name: 'Gumball',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783627226/Gumball_nhjfrn.png',
  },
  {
    id: 'yes_drop.alien',
    name: 'Alien',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783627319/Alien_co5fwa.png',
  },
  {
    id: 'yes_drop.rubber_duck',
    name: 'Rubber Duck',
    imageUrl: 'https://res.cloudinary.com/dr2hz2tmw/image/upload/v1783627385/Rubber_Duck_ze5wif.png',
  },
]);

const SKIN_BY_ID = new Map(COIN_SKINS.map((skin) => [skin.id, skin]));

export function getCoinSkin(id) {
  return SKIN_BY_ID.get(String(id ?? '').trim()) ?? null;
}
