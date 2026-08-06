const VI_LABELS: Record<string, string> = {
  airplane: 'máy bay', apple: 'quả táo', bicycle: 'xe đạp', bird: 'con chim', book: 'quyển sách',
  bus: 'xe buýt', butterfly: 'con bướm', car: 'ô tô', cat: 'con mèo', chair: 'cái ghế',
  cloud: 'đám mây', coffee_cup: 'cốc cà phê', cup: 'cái cốc', dog: 'con chó', door: 'cánh cửa',
  eye: 'con mắt', face: 'khuôn mặt', fish: 'con cá', flower: 'bông hoa', fork: 'cái nĩa',
  hand: 'bàn tay', hat: 'cái mũ', headphones: 'tai nghe', helicopter: 'trực thăng', house: 'ngôi nhà',
  key: 'chìa khóa', knife: 'con dao', laptop: 'máy tính xách tay', moon: 'mặt trăng', mountain: 'ngọn núi',
  pencil: 'bút chì', phone: 'điện thoại', pizza: 'bánh pizza', rabbit: 'con thỏ', rainbow: 'cầu vồng',
  scissors: 'cái kéo', shoe: 'chiếc giày', smiley_face: 'mặt cười', star: 'ngôi sao', sun: 'mặt trời',
  table: 'cái bàn', tree: 'cái cây', truck: 'xe tải', umbrella: 'cái ô', watch: 'đồng hồ',
  wheelchair: 'xe lăn'
};

export function localizeSketchLabel(label: string): string {
  const key = label.trim().toLowerCase().replace(/[ -]+/g, '_');
  return VI_LABELS[key] ?? label.replaceAll('_', ' ');
}
