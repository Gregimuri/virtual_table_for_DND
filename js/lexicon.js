'use strict';

// Русский запрос к английским именам файлов. Короткие английские слова
// сравниваются целиком, чтобы «eat» не находило leather.
const VTTLex = (() => {
  const ENTRIES = [
    ['еда|ест|ем|ешь|едят|поесть|кушать|кушает', 'food foods meal meals eats eating snack snacks ration rations feast provision provisions'],
    ['хлеб', 'bread loaf bakery bun buns'],
    ['мясо', 'meat steak beef ham bacon roast'],
    ['рыба', 'fish fishes fishing seafood'],
    ['фрукт', 'fruit fruits apple apples berry berries grape grapes'],
    ['яблоко', 'apple apples'],
    ['ягода', 'berry berries'],
    ['виноград', 'grape grapes'],
    ['лимон', 'lemon lemons'],
    ['апельсин', 'orange oranges'],
    ['банан', 'banana bananas'],
    ['орех', 'nut nuts walnut'],
    ['овощ', 'vegetable vegetables carrot carrots cabbage onion potato potatoes'],
    ['капуста', 'cabbage'],
    ['морковь', 'carrot carrots'],
    ['картофель|картошка', 'potato potatoes'],
    ['лук', 'onion onions bow bows'],
    ['чеснок', 'garlic'],
    ['сыр', 'cheese'],
    ['яйцо', 'egg eggs'],
    ['суп', 'soup stew broth'],
    ['рагу', 'stew'],
    ['жаркое', 'roast'],
    ['пирог', 'pie pies cake cakes'],
    ['торт', 'cake cakes'],
    ['колбаса', 'sausage sausages'],
    ['курица', 'chicken chickens poultry'],
    ['свинья', 'pig pigs boar pork'],
    ['корова', 'cow cows cattle beef'],
    ['овца', 'sheep lamb'],
    ['коза', 'goat goats'],
    ['мёд|мед', 'honey mead'],
    ['молоко', 'milk'],
    ['масло', 'butter oil'],
    ['соль', 'salt'],
    ['перец', 'pepper'],
    ['сахар', 'sugar'],
    ['зерно', 'grain grains wheat corn'],
    ['мука', 'flour'],
    ['рис', 'rice'],
    ['напиток', 'drink drinks beverage beverages'],
    ['вода', 'water waters'],
    ['вино', 'wine wines'],
    ['пиво', 'beer ale mead'],
    ['кружка', 'mug mugs tankard tankards cup cups'],
    ['бутылка|бутыль', 'bottle bottles flask flasks'],
    ['фляга', 'flask flasks canteen'],
    ['тарелка', 'plate plates platter platters'],
    ['миска', 'bowl bowls'],
    ['чашка', 'cup cups mug mugs'],
    ['бокал|кубок', 'glass glasses goblet goblets chalice cup'],
    ['ложка', 'spoon spoons'],
    ['вилка', 'fork forks'],
    ['нож', 'knife knives'],
    ['котёл|котел|котелок', 'cauldron cauldrons pot pots'],
    ['горшок', 'pot pots jar jars'],
    ['кувшин', 'jug jugs pitcher pitchers'],
    ['ведро', 'bucket buckets pail pails'],
    ['сковорода', 'pan pans skillet frying'],
    ['крышка', 'lid lids cover covers'],
    ['стол', 'table tables desk desks'],
    ['стул|стулья|стульев', 'chair chairs stool stools seat seats'],
    ['скамья|скамейка', 'bench benches pew pews'],
    ['кровать', 'bed beds bedroom bedroll bunk bunks'],
    ['диван', 'sofa sofas couch couches'],
    ['кресло', 'armchair armchairs chair chairs'],
    ['шкаф', 'wardrobe wardrobes closet closets cupboard cupboards cabinet cabinets armoire'],
    ['полка', 'shelf shelves bookshelf bookshelves'],
    ['сундук', 'chest chests coffer coffers'],
    ['ящик', 'crate crates box boxes drawer drawers'],
    ['бочка', 'barrel barrels cask casks keg kegs'],
    ['корзина', 'basket baskets'],
    ['мешок', 'sack sacks bag bags pouch pouches'],
    ['тюк|свёрток|сверток', 'bale bundle bundles parcel'],
    ['дверь', 'door doors doorway doorways'],
    ['окно', 'window windows'],
    ['стена', 'wall walls'],
    ['пол', 'floor floors flooring'],
    ['потолок', 'ceiling ceilings'],
    ['лестница', 'stair stairs staircase staircases ladder ladders steps'],
    ['крыша', 'roof roofs rooftop'],
    ['крыльцо', 'porch porches stoop'],
    ['забор', 'fence fences railing railings'],
    ['ворота', 'gate gates'],
    ['колонна', 'column columns pillar pillars'],
    ['арка', 'arch arches archway archways'],
    ['мост', 'bridge bridges'],
    ['башня', 'tower towers'],
    ['замок', 'castle castles keep fortress fortresses lock locks padlock'],
    ['ключ', 'key keys'],
    ['камин', 'fireplace fireplaces hearth hearths chimney chimneys'],
    ['печь', 'oven ovens furnace furnaces stove stoves'],
    ['костёр|костер', 'campfire campfires bonfire bonfires firepit'],
    ['огонь', 'fire fires flame flames'],
    ['свеча', 'candle candles'],
    ['факел', 'torch torches'],
    ['фонарь', 'lantern lanterns lamp lamps'],
    ['люстра', 'chandelier chandeliers'],
    ['ковёр|ковер', 'carpet carpets rug rugs'],
    ['занавеска|штора', 'curtain curtains drape drapes'],
    ['картина', 'painting paintings picture pictures portrait portraits'],
    ['зеркало', 'mirror mirrors'],
    ['книга', 'book books'],
    ['свиток|пергамент', 'scroll scrolls parchment paper'],
    ['карта', 'map maps chart charts'],
    ['монета', 'coin coins currency'],
    ['золото', 'gold'],
    ['серебро', 'silver'],
    ['медь', 'copper bronze'],
    ['бронза', 'bronze copper'],
    ['деньги', 'money coins coin gold treasure'],
    ['сокровище|клад', 'treasure treasures loot hoard cache'],
    ['алмаз', 'gem gems diamond diamonds jewel jewels'],
    ['кристалл', 'crystal crystals'],
    ['алтарь', 'altar altars shrine shrines'],
    ['статуя', 'statue statues sculpture sculptures'],
    ['череп', 'skull skulls'],
    ['кость', 'bone bones skeleton skeletons'],
    ['могила', 'grave graves tomb tombs coffin coffins'],
    ['гроб', 'coffin coffins sarcophagus'],
    ['скелет', 'skeleton skeletons skull skulls'],
    ['привидение|призрак', 'ghost ghosts spirit spirits specter spectre wraith'],
    ['зомби', 'zombie zombies'],
    ['дракон', 'dragon dragons'],
    ['волк', 'wolf wolves'],
    ['медведь', 'bear bears'],
    ['крыса', 'rat rats'],
    ['паук', 'spider spiders'],
    ['паутина', 'web webs cobweb cobwebs'],
    ['летучая мышь', 'bat bats'],
    ['оружие', 'weapon weapons'],
    ['меч', 'sword swords blade blades'],
    ['топор', 'axe axes hatchet'],
    ['стрела', 'arrow arrows'],
    ['щит', 'shield shields'],
    ['кинжал', 'dagger daggers knife knives'],
    ['посох', 'staff staves staffs wand wands'],
    ['броня', 'armor armour armors'],
    ['шлем', 'helmet helmets helm helms'],
    ['сапог|ботинок', 'boot boots shoe shoes'],
    ['плащ', 'cloak cloaks cape capes'],
    ['рубашка', 'shirt shirts'],
    ['штаны', 'pants trousers'],
    ['шляпа', 'hat hats'],
    ['перчатка', 'glove gloves'],
    ['одежда', 'clothes clothing cloth garment garments'],
    ['кольцо', 'ring rings'],
    ['ожерелье', 'necklace necklaces amulet amulets'],
    ['корона', 'crown crowns'],
    ['человек', 'human humans person people man men woman women'],
    ['мужчина', 'man men male'],
    ['женщина', 'woman women female'],
    ['ребёнок|ребенок|дети', 'child children kid kids'],
    ['страж', 'guard guards soldier soldiers'],
    ['рыцарь', 'knight knights'],
    ['король', 'king kings'],
    ['королева', 'queen queens'],
    ['маг', 'mage mages wizard wizards sorcerer'],
    ['жрец', 'priest priests cleric clerics'],
    ['вор', 'thief thieves rogue rogues'],
    ['купец', 'merchant merchants trader traders'],
    ['крестьянин', 'peasant peasants villager villagers'],
    ['лошадь', 'horse horses steed mount'],
    ['собака', 'dog dogs hound hounds'],
    ['кошка', 'cat cats'],
    ['птица', 'bird birds'],
    ['орёл|орел', 'eagle eagles'],
    ['ворон', 'raven ravens crow crows'],
    ['змея', 'snake snakes serpent serpents'],
    ['сова', 'owl owls'],
    ['ястреб', 'hawk hawks'],
    ['голубь', 'pigeon dove'],
    ['петух', 'rooster'],
    ['утка', 'duck ducks'],
    ['гусь', 'goose geese'],
    ['кабан', 'boar boars'],
    ['олень', 'deer stag'],
    ['лось', 'moose elk'],
    ['лиса', 'fox foxes'],
    ['заяц', 'rabbit rabbits hare hares'],
    ['белка', 'squirrel'],
    ['мышь', 'mouse mice rat rats'],
    ['лягушка', 'frog frogs toad toads'],
    ['жаба', 'toad toads'],
    ['ящерица|ящер', 'lizard lizards lizardfolk lizardmen'],
    ['черепаха', 'turtle tortoise'],
    ['краб', 'crab crabs'],
    ['осьминог', 'octopus'],
    ['акула', 'shark sharks'],
    ['кит', 'whale'],
    ['рыба', 'fish fishes'],
    ['эльф', 'elf elves'],
    ['дварф', 'dwarf dwarves'],
    ['гном', 'gnome gnomes'],
    ['орк', 'orc orcs'],
    ['гоблин', 'goblin goblins'],
    ['хоббит', 'halfling halflings hobbit'],
    ['великан', 'giant giants'],
    ['тролль', 'troll trolls'],
    ['огр', 'ogre ogres'],
    ['демон', 'demon demons fiend'],
    ['дьявол', 'devil devils'],
    ['ангел', 'angel angels'],
    ['нежить', 'undead'],
    ['вампир', 'vampire vampires'],
    ['оборотень', 'werewolf werewolves'],
    ['элементаль', 'elemental elementals'],
    ['голем', 'golem golems'],
    ['слайм', 'slime slimes ooze'],
    ['кобольд', 'kobold kobolds'],
    ['бехолдер', 'beholder'],
    ['лич', 'lich'],
    ['мумия', 'mummy'],
    ['тень', 'shadow shadows'],
    ['гуль|вурдалак', 'ghoul ghouls'],
    ['виверна', 'wyvern'],
    ['единорог', 'unicorn'],
    ['грифон', 'griffin griffon'],
    ['феникс', 'phoenix'],
    ['минотавр', 'minotaur'],
    ['кентавр', 'centaur'],
    ['фея', 'fairy fairies faerie'],
    ['гидра', 'hydra'],
    ['дерево|деревья', 'tree trees wood wooden log logs timber'],
    ['лес', 'forest forests wood woods tree trees'],
    ['куст', 'bush bushes shrub shrubs'],
    ['трава', 'grass grasses'],
    ['цветок', 'flower flowers blossom blossoms'],
    ['растение', 'plant plants'],
    ['гриб', 'mushroom mushrooms fungi fungus'],
    ['камень', 'stone stones rock rocks'],
    ['скала', 'rock rocks cliff cliffs boulder boulders'],
    ['земля', 'dirt ground earth soil mud'],
    ['песок', 'sand sands'],
    ['река', 'river rivers stream streams'],
    ['озеро', 'lake lakes pond ponds'],
    ['море', 'sea ocean water'],
    ['гора', 'mountain mountains hill hills'],
    ['пещера', 'cave caves cavern caverns'],
    ['дорога', 'road roads path paths street streets'],
    ['тропа', 'path paths trail trails'],
    ['деревня', 'village villages'],
    ['город', 'city cities town towns'],
    ['таверна', 'tavern taverns inn inns'],
    ['храм', 'temple temples church churches'],
    ['церковь', 'church churches chapel chapels'],
    ['кузница|наковальня', 'forge forges smithy anvil anvils'],
    ['мельница', 'mill mills windmill'],
    ['колодец', 'well wells'],
    ['конюшня', 'stable stables'],
    ['сарай', 'barn barns shed sheds'],
    ['хижина', 'hut huts shack shacks cabin cabins'],
    ['дом', 'house houses home homes cottage cottages'],
    ['дворец', 'palace palaces'],
    ['руины', 'ruin ruins ruined'],
    ['подземелье', 'dungeon dungeons crypt crypts'],
    ['темница', 'dungeon dungeons prison prisons jail'],
    ['комната', 'room rooms chamber chambers'],
    ['коридор', 'corridor corridors hallway hallways passage'],
    ['зал', 'hall halls chamber'],
    ['кухня', 'kitchen kitchens'],
    ['спальня', 'bedroom bedrooms'],
    ['библиотека', 'library libraries'],
    ['лаборатория', 'laboratory lab'],
    ['склад', 'storage warehouse storeroom'],
    ['рынок', 'market markets stall stalls'],
    ['лавка', 'shop shops stall stalls'],
    ['прилавок', 'counter counters stall'],
    ['фонтан', 'fountain fountains'],
    ['вывеска|знак', 'sign signs signpost signboard'],
    ['доска', 'board boards plank planks'],
    ['яма', 'pit pits hole holes'],
    ['ловушка', 'trap traps'],
    ['верёвка|веревка', 'rope ropes'],
    ['цепь', 'chain chains'],
    ['решётка|решетка', 'grate grates bars portcullis grill'],
    ['клетка', 'cage cages cell'],
    ['флаг|знамя', 'flag flags banner banners'],
    ['герб', 'crest crests emblem emblems'],
    ['зелье', 'potion potions vial vials flask'],
    ['чернила', 'ink inkwell'],
    ['перо', 'quill quills feather feathers'],
    ['компас', 'compass'],
    ['подзорная труба', 'spyglass telescope'],
    ['подушка', 'pillow pillows cushion cushions'],
    ['одеяло', 'blanket blankets'],
    ['простыня', 'sheet sheets'],
    ['ванна', 'bath bathtub tub'],
    ['умывальник', 'sink basin washbasin'],
    ['туалет', 'toilet latrine privy'],
    ['мыло', 'soap'],
    ['расчёска|расческа', 'comb'],
    ['трон', 'throne thrones'],
    ['лютня', 'lute lutes'],
    ['барабан', 'drum drums'],
    ['колокол', 'bell bells'],
    ['арфа', 'harp harps'],
    ['музыка', 'music instrument instruments'],
    ['лодка', 'boat boats'],
    ['корабль', 'ship ships boat'],
    ['телега', 'cart carts wagon wagons'],
    ['колесо', 'wheel wheels'],
    ['якорь', 'anchor anchors'],
    ['ткань', 'cloth fabric textile'],
    ['мех', 'fur pelt pelts'],
    ['кожа', 'leather hide hides'],
    ['шёлк|шелк', 'silk'],
    ['шерсть', 'wool'],
    ['железо', 'iron'],
    ['сталь', 'steel'],
    ['стекло', 'glass'],
    ['керамика|глина', 'ceramic pottery clay'],
    ['деревянный', 'wood wooden'],
    ['каменный', 'stone stones rock'],
    ['металлический', 'metal metals iron steel'],
    ['сломанный', 'broken ruined damaged wrecked'],
    ['открытый', 'open opened'],
    ['закрытый', 'closed shut'],
    ['большой', 'large big huge giant'],
    ['маленький', 'small little tiny'],
    ['старый', 'old ancient aged'],
    ['новый', 'new'],
    ['круглый', 'round circular'],
    ['квадратный', 'square'],
    ['пустой', 'empty'],
    ['полный', 'full'],
    ['грязный|грязь', 'dirty mud muddy dirt'],
    ['чистый', 'clean'],
    ['горящий', 'burning lit flaming'],
    ['мокрый', 'wet soaked'],
    ['сухой', 'dry'],
    ['высокий', 'tall high'],
    ['низкий', 'low short'],
    ['широкий', 'wide broad'],
    ['узкий', 'narrow'],
    ['длинный', 'long'],
    ['короткий', 'short'],
    ['толстый', 'thick fat'],
    ['тонкий', 'thin'],
    ['тяжёлый|тяжелый', 'heavy'],
    ['лёгкий|легкий', 'light'],
    ['тёмный|темный', 'dark'],
    ['светлый', 'light bright'],
    ['красный', 'red'],
    ['синий', 'blue'],
    ['зелёный|зеленый', 'green'],
    ['жёлтый|желтый', 'yellow'],
    ['белый', 'white'],
    ['чёрный|черный', 'black'],
    ['коричневый', 'brown'],
    ['серый', 'gray grey'],
    ['золотой', 'gold golden'],
    ['серебряный', 'silver'],
    ['кровь', 'blood bloody'],
    ['снег', 'snow icy ice'],
    ['лёд|лед', 'ice icy'],
    ['лава', 'lava'],
    ['пепел', 'ash ashes'],
    ['дым', 'smoke'],
    ['туман', 'fog mist'],
    ['труп', 'corpse corpses body bodies dead'],
    ['рана', 'wound wounds'],
    ['крыло', 'wing wings'],
    ['хвост', 'tail tails'],
    ['рог', 'horn horns'],
    ['клык', 'fang fangs tusk tusks'],
    ['коготь', 'claw claws'],
    ['чешуя', 'scale scales'],
    ['глаз', 'eye eyes'],
    ['рука', 'hand hands arm arms'],
    ['нога', 'leg legs foot feet'],
    ['голова', 'head heads'],
    ['лицо', 'face faces'],
    ['сейф', 'safe coffer'],
  ];

  function fold(value) {
    return String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е');
  }

  function ruForms(word) {
    const forms = new Set([word]);
    const add = (stem, ends) => {
      ends.forEach((end) => {
        const form = stem + end;
        if (form.length >= 3) forms.add(form);
      });
    };
    if (/(ый|ий|ой)$/.test(word) && word.length >= 4) {
      add(word.replace(/(ый|ий|ой)$/, ''), ['ый', 'ий', 'ой', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ого', 'его', 'ому', 'ему', 'ым', 'им', 'ом', 'ем', 'ую', 'юю']);
    } else if (/[ая]$/.test(word)) {
      add(word.slice(0, -1), ['а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'ой', 'ей', 'ою', 'ею', 'ам', 'ям', 'ами', 'ями', 'ах', 'ях']);
    } else if (/[оеё]$/.test(word) && word.length > 3) {
      add(word.slice(0, -1), ['о', 'е', 'а', 'у', 'ом', 'ем', 'ах']);
    } else if (/ь$/.test(word)) {
      add(word.slice(0, -1), ['ь', 'я', 'ю', 'и', 'е', 'ем', 'ей']);
    } else {
      add(word, ['', 'а', 'у', 'ом', 'е', 'ы', 'и', 'ов', 'ев', 'ам', 'ами', 'ах']);
    }
    return forms;
  }

  function build(entries) {
    const map = new Map();
    const put = (form, english) => {
      const prev = map.get(form);
      if (!prev) {
        map.set(form, english.slice());
        return;
      }
      english.forEach((word) => {
        if (!prev.includes(word)) prev.push(word);
      });
    };
    entries.forEach(([ru, en]) => {
      const english = en.split(/\s+/).filter(Boolean);
      ru.split('|').forEach((form, index) => {
        const folded = fold(form);
        if (!folded) return;
        if (folded.includes(' ') || index > 0) {
          put(folded, english);
          return;
        }
        ruForms(folded).forEach((item) => put(item, english));
      });
    });
    return map;
  }

  const LOOKUP = build(ENTRIES);

  function wordsOf(text) {
    const raw = String(text || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    return fold(raw).split(/[^0-9a-zа-яе]+/i).filter(Boolean);
  }

  function covers(words, term) {
    if (!term) return false;
    if (term.length <= 3) return words.some((word) => word === term);
    return words.some((word) => word.includes(term));
  }

  function objectQuery(raw) {
    const query = fold(String(raw || '').trim());
    if (!query) return { query: '', groups: [] };
    const known = LOOKUP.get(query);
    if (known) return { query, groups: [[query].concat(known)] };
    const words = query.split(/[^0-9a-zа-яе]+/i).filter((word) => word.length >= 2);
    const source = words.length ? words : [query];
    return {
      query,
      groups: source.map((word) => {
        const extra = LOOKUP.get(word);
        return extra ? [word].concat(extra) : [word];
      }),
    };
  }

  function objectHit(hay, parsed) {
    if (!parsed || !parsed.query) return false;
    const text = fold(hay);
    if (text.includes(parsed.query)) return true;
    const words = wordsOf(text);
    return parsed.groups.every((group) => group.some((term) => covers(words, term)));
  }

  return { objectQuery, objectHit };
})();
