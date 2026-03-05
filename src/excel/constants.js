export const flatIdPattern = /^[A-Z]-\d+-\d+$/;

export const HEADER_KEYWORDS = {
    id: [
        "բն", "բն.", "հ/հ", "բ/ն", "բ/հ", "բնակ", "բնակ.",
        "№", "համար", "no", "no.", "number", "номер",
        "кв", "кв.", "квартира", "апартамент",
        "apartment", "apt", "flat", "unit", "id",
        "n", "n."
    ],

    floor: ["Հարկ",
        "հարկ", "этаж", "этажи", "уровень", "ур.",
        "floor", "fl", "fl.", "storey", "story", "level"
    ],

    area: [
        "քմ", "մ²", "մ2", "մ 2",
        "մակերես", "площадь", "пл", "пл.",
        "area", "size", "sq.m", "sqm", "m²", "m2",
        "square meter", "square meters",
        "кв.м", "кв. м"
    ],

    new_area: [
        "նոր քմ", "новая площадь", "new area"
    ],

    rooms: [
        "սենյակ", "սեն.", "սեն",
        "комната", "комнаты", "комн",
        "room", "rooms", "bedroom", "bedrooms",
        "rm", "rms", "#rooms", "no. of rooms",
        "սենյակների քանակ"
    ],

    price_sqm: [
        "արժեք", "1 քմ", "1քմ", "price per", "cost per",
        "цена за м", "стоимость за м",
        "դրամ/քմ", "$/քմ"
    ],

    price_total: [
        "ընդհանուր", "ընդհանուր գին",
        "общая цена", "итоговая цена",
        "total", "total price", "full price", "overall price",
        "ընդհանուր գինը", "ընդհանուր արժեք"
    ],

    status: [
        "կարգավիճակ", "իրավիճակ", "վիճակ",
        "статус", "состояние",
        "status", "availability", "condition", "avail"
    ]
};

export const CURRENCY_SYMBOLS = ["$", "֏", "€", "₽", "usd", "amd", "eur", "դրամ"];
export const AREA_SYMBOLS = ["մ²", "м²", "sqm", "sq.m", "кв.м", "m2", "մ2", "մ 2", "м2"];

// Price thresholds for heuristic detection
export const PRICE_MIN_THRESHOLD = 1_000_000;   // values above this COULD be price
export const PRICE_SAFE_THRESHOLD = 10_000_000; // values above this are almost certainly price
export const AREA_MIN = 10;
export const AREA_MAX = 1000;
export const FLOOR_MIN = -5;
export const FLOOR_MAX = 150;
export const ROOMS_MIN = 1;
export const ROOMS_MAX = 20;
