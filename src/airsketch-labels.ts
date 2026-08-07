// Vietnamese display names for every class in the pinned 345-class QuickDraw model.
// Keep keys normalized with normalizeSketchLabel(); coverage is enforced by unit tests.
export const QUICKDRAW_VI_LABELS: Readonly<Record<string, string>> = {
  aircraft_carrier: 'tàu sân bay', airplane: 'máy bay', alarm_clock: 'đồng hồ báo thức', ambulance: 'xe cứu thương', angel: 'thiên thần',
  animal_migration: 'đàn thú di cư', ant: 'con kiến', anvil: 'cái đe', apple: 'quả táo', arm: 'cánh tay', asparagus: 'măng tây', axe: 'cái rìu',
  backpack: 'ba lô', banana: 'quả chuối', bandage: 'băng gạc', barn: 'nhà kho', baseball_bat: 'gậy bóng chày', baseball: 'quả bóng chày',
  basket: 'cái giỏ', basketball: 'quả bóng rổ', bat: 'con dơi', bathtub: 'bồn tắm', beach: 'bãi biển', bear: 'con gấu', beard: 'bộ râu', bed: 'cái giường',
  bee: 'con ong', belt: 'thắt lưng', bench: 'ghế dài', bicycle: 'xe đạp', binoculars: 'ống nhòm', bird: 'con chim', birthday_cake: 'bánh sinh nhật',
  blackberry: 'quả mâm xôi đen', blueberry: 'quả việt quất', book: 'quyển sách', boomerang: 'boomerang', bottlecap: 'nắp chai', bowtie: 'nơ cổ',
  bracelet: 'vòng tay', brain: 'bộ não', bread: 'ổ bánh mì', bridge: 'cây cầu', broccoli: 'bông cải xanh', broom: 'cây chổi', bucket: 'cái xô',
  bulldozer: 'xe ủi', bus: 'xe buýt', bush: 'bụi cây', butterfly: 'con bướm', cactus: 'xương rồng', cake: 'bánh ngọt', calculator: 'máy tính bỏ túi',
  calendar: 'lịch', camel: 'lạc đà', camera: 'máy ảnh', camouflage: 'ngụy trang', campfire: 'đống lửa', candle: 'cây nến', cannon: 'đại bác', canoe: 'xuồng',
  car: 'ô tô', carrot: 'cà rốt', castle: 'lâu đài', cat: 'con mèo', ceiling_fan: 'quạt trần', cell_phone: 'điện thoại di động', cello: 'đàn cello',
  chair: 'cái ghế', chandelier: 'đèn chùm', church: 'nhà thờ', circle: 'hình tròn', clarinet: 'kèn clarinet', clock: 'đồng hồ', cloud: 'đám mây',
  coffee_cup: 'cốc cà phê', compass: 'la bàn', computer: 'máy tính', cookie: 'bánh quy', cooler: 'thùng giữ lạnh', couch: 'ghế sofa', cow: 'con bò',
  crab: 'con cua', crayon: 'bút sáp màu', crocodile: 'cá sấu', crown: 'vương miện', cruise_ship: 'tàu du lịch', cup: 'cái cốc', diamond: 'viên kim cương',
  dishwasher: 'máy rửa bát', diving_board: 'ván nhảy cầu', dog: 'con chó', dolphin: 'cá heo', donut: 'bánh vòng', door: 'cánh cửa', dragon: 'con rồng',
  dresser: 'tủ ngăn kéo', drill: 'máy khoan', drums: 'bộ trống', duck: 'con vịt', dumbbell: 'quả tạ', ear: 'tai', elbow: 'khuỷu tay', elephant: 'con voi',
  envelope: 'phong bì', eraser: 'cục tẩy', eye: 'con mắt', eyeglasses: 'kính mắt', face: 'khuôn mặt', fan: 'cái quạt', feather: 'lông vũ', fence: 'hàng rào',
  finger: 'ngón tay', fire_hydrant: 'trụ cứu hỏa', fireplace: 'lò sưởi', firetruck: 'xe cứu hỏa', fish: 'con cá', flamingo: 'chim hồng hạc',
  flashlight: 'đèn pin', flip_flops: 'dép xỏ ngón', floor_lamp: 'đèn sàn', flower: 'bông hoa', flying_saucer: 'đĩa bay', foot: 'bàn chân', fork: 'cái nĩa',
  frog: 'con ếch', frying_pan: 'chảo rán', garden_hose: 'vòi tưới cây', garden: 'khu vườn', giraffe: 'hươu cao cổ', goatee: 'râu dê', golf_club: 'gậy golf',
  grapes: 'chùm nho', grass: 'cỏ', guitar: 'đàn guitar', hamburger: 'bánh hamburger', hammer: 'cái búa', hand: 'bàn tay', harp: 'đàn hạc', hat: 'cái mũ',
  headphones: 'tai nghe', hedgehog: 'con nhím', helicopter: 'trực thăng', helmet: 'mũ bảo hiểm', hexagon: 'hình lục giác', hockey_puck: 'bóng khúc côn cầu',
  hockey_stick: 'gậy khúc côn cầu', horse: 'con ngựa', hospital: 'bệnh viện', hot_air_balloon: 'khinh khí cầu', hot_dog: 'bánh mì xúc xích', hot_tub: 'bồn tắm nóng',
  hourglass: 'đồng hồ cát', house_plant: 'cây trong nhà', house: 'ngôi nhà', hurricane: 'bão lớn', ice_cream: 'kem', jacket: 'áo khoác', jail: 'nhà tù',
  kangaroo: 'chuột túi', key: 'chìa khóa', keyboard: 'bàn phím', knee: 'đầu gối', knife: 'con dao', ladder: 'cái thang', lantern: 'đèn lồng',
  laptop: 'máy tính xách tay', leaf: 'chiếc lá', leg: 'chân', light_bulb: 'bóng đèn', lighter: 'bật lửa', lighthouse: 'hải đăng', lightning: 'tia chớp',
  line: 'đường thẳng', lion: 'sư tử', lipstick: 'son môi', lobster: 'tôm hùm', lollipop: 'kẹo mút', mailbox: 'hòm thư', map: 'bản đồ', marker: 'bút dạ',
  matches: 'que diêm', megaphone: 'loa cầm tay', mermaid: 'nàng tiên cá', microphone: 'micro', microwave: 'lò vi sóng', monkey: 'con khỉ', moon: 'mặt trăng',
  mosquito: 'con muỗi', motorbike: 'xe máy', mountain: 'ngọn núi', mouse: 'con chuột', moustache: 'ria mép', mouth: 'miệng', mug: 'cốc có quai', mushroom: 'cây nấm',
  nail: 'cái đinh', necklace: 'vòng cổ', nose: 'mũi', ocean: 'đại dương', octagon: 'hình bát giác', octopus: 'bạch tuộc', onion: 'củ hành', oven: 'lò nướng',
  owl: 'con cú', paint_can: 'hộp sơn', paintbrush: 'cọ vẽ', palm_tree: 'cây cọ', panda: 'gấu trúc', pants: 'quần dài', paper_clip: 'kẹp giấy',
  parachute: 'dù', parrot: 'con vẹt', passport: 'hộ chiếu', peanut: 'hạt lạc', pear: 'quả lê', peas: 'đậu Hà Lan', pencil: 'bút chì', penguin: 'chim cánh cụt',
  piano: 'đàn piano', pickup_truck: 'xe bán tải', picture_frame: 'khung ảnh', pig: 'con lợn', pillow: 'cái gối', pineapple: 'quả dứa', pizza: 'bánh pizza',
  pliers: 'cái kìm', police_car: 'xe cảnh sát', pond: 'ao', pool: 'bể bơi', popsicle: 'kem que', postcard: 'bưu thiếp', potato: 'củ khoai tây',
  power_outlet: 'ổ cắm điện', purse: 'ví cầm tay', rabbit: 'con thỏ', raccoon: 'gấu mèo', radio: 'đài radio', rain: 'mưa', rainbow: 'cầu vồng', rake: 'cái cào',
  remote_control: 'điều khiển từ xa', rhinoceros: 'tê giác', rifle: 'súng trường', river: 'dòng sông', roller_coaster: 'tàu lượn', rollerskates: 'giày patin',
  sailboat: 'thuyền buồm', sandwich: 'bánh sandwich', saw: 'cái cưa', saxophone: 'kèn saxophone', school_bus: 'xe buýt trường học', scissors: 'cái kéo',
  scorpion: 'bọ cạp', screwdriver: 'tua vít', sea_turtle: 'rùa biển', see_saw: 'bập bênh', shark: 'cá mập', sheep: 'con cừu', shoe: 'chiếc giày', shorts: 'quần đùi',
  shovel: 'cái xẻng', sink: 'bồn rửa', skateboard: 'ván trượt', skull: 'hộp sọ', skyscraper: 'nhà chọc trời', sleeping_bag: 'túi ngủ', smiley_face: 'mặt cười',
  snail: 'ốc sên', snake: 'con rắn', snorkel: 'ống thở', snowflake: 'bông tuyết', snowman: 'người tuyết', soccer_ball: 'quả bóng đá', sock: 'chiếc tất',
  speedboat: 'ca nô cao tốc', spider: 'con nhện', spoon: 'cái thìa', spreadsheet: 'bảng tính', square: 'hình vuông', squiggle: 'nét ngoằn ngoèo',
  squirrel: 'con sóc', stairs: 'cầu thang', star: 'ngôi sao', steak: 'bít tết', stereo: 'dàn âm thanh', stethoscope: 'ống nghe y tế', stitches: 'vết khâu',
  stop_sign: 'biển dừng', stove: 'bếp', strawberry: 'quả dâu tây', streetlight: 'đèn đường', string_bean: 'đậu cô ve', submarine: 'tàu ngầm', suitcase: 'va li',
  sun: 'mặt trời', swan: 'thiên nga', sweater: 'áo len', swing_set: 'xích đu', sword: 'thanh kiếm', syringe: 'ống tiêm', 't-shirt': 'áo thun', table: 'cái bàn',
  teapot: 'ấm trà', 'teddy-bear': 'gấu bông', telephone: 'điện thoại bàn', television: 'ti vi', tennis_racquet: 'vợt tennis', tent: 'lều',
  the_eiffel_tower: 'tháp Eiffel', the_great_wall_of_china: 'Vạn Lý Trường Thành', the_mona_lisa: 'nàng Mona Lisa', tiger: 'con hổ', toaster: 'máy nướng bánh mì',
  toe: 'ngón chân', toilet: 'bồn cầu', tooth: 'chiếc răng', toothbrush: 'bàn chải đánh răng', toothpaste: 'kem đánh răng', tornado: 'lốc xoáy', tractor: 'máy kéo',
  traffic_light: 'đèn giao thông', train: 'tàu hỏa', tree: 'cái cây', triangle: 'hình tam giác', trombone: 'kèn trombone', truck: 'xe tải', trumpet: 'kèn trumpet',
  umbrella: 'cái ô', underwear: 'đồ lót', van: 'xe van', vase: 'bình hoa', violin: 'đàn violin', washing_machine: 'máy giặt', watermelon: 'quả dưa hấu',
  waterslide: 'máng trượt nước', whale: 'cá voi', wheel: 'bánh xe', windmill: 'cối xay gió', wine_bottle: 'chai rượu vang', wine_glass: 'ly rượu vang',
  wristwatch: 'đồng hồ đeo tay', yoga: 'tư thế yoga', zebra: 'ngựa vằn', zigzag: 'đường zích zắc'
};

// Local pictograms detected outside the pinned 345-class model.
const SPECIAL_SKETCH_VI_LABELS: Readonly<Record<string, string>> = { heart: 'trái tim' };

export function normalizeSketchLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[ ]+/g, '_');
}

export function hasVietnameseSketchLabel(label: string): boolean {
  return Object.hasOwn(QUICKDRAW_VI_LABELS, normalizeSketchLabel(label));
}

export function localizeSketchLabel(label: string): string {
  const key = normalizeSketchLabel(label);
  return QUICKDRAW_VI_LABELS[key] ?? SPECIAL_SKETCH_VI_LABELS[key] ?? 'vật thể chưa có tên tiếng Việt';
}
