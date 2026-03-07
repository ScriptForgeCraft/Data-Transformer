export const flatIdPattern = /^[A-Z]-\d+-\d+$/;

export const HEADER_KEYWORDS = {
    id: [
        "բն", "բն.", "հ/հ", "բ/ն", "բ/հ", "բնակ", "բնակ.", "բնակարան", "բնակարանի",
        "№", "համար", "no", "no.", "number", "номер",
        "кв", "кв.", "квартира", "апартамент",
        "apartment", "apt", "flat", "unit", "id",
        "n", "n."
    ],

    floor: ["Հարկ",
        "հարկ", "этаж", "этажи", "уровень", "ур.",
        "floor", "fl", "fl.", "storey", "story", "level"
    ],

    area: ["Բնակարանի մակերես",
        "քմ", "մ²", "մ2", "մ 2",
        "մակերես", "մակերեսը", "հողատարածք", "հողատարածքի չափ", "площадь", "пл", "пл.",
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
        "1 քմ", "1քմ", "1 քմ-ի արժեք", "price per", "cost per",
        "цена за м", "стоимость за м",
        "դրամ/քմ", "$/քմ", "1քմ արժեք", "1քմ արժեքը", "1քմ արժեքը զեղչ"
    ],

    price_total: [
        "ընդհանուր", "ընդհանուր գին",
        "общая цена", "итоговая цена",
        "total", "total price", "full price", "overall price",
        "ընդհանուր գինը", "ընդհանուր արժեք", "ընդ. արժեք", "ընդ. արժեք նոր"
    ],

    price_ambiguous: [
        "գին", "գինը", "արժեք", "արժեքը", "price", "cost", "цена", "стоимость"
    ],

    price_sqm_sale: [
        "zeghchvats 1qm", "1qm zeghchvats", "1 qm zeghchvats",
        "discounted sqm", "sale sqm", "со скидкой за м"
    ],

    price_total_sale: [
        "zeghchvats endhanur", "endhanur zeghchvats",
        "discounted total", "sale price", "final price",
        "со скидкой итого"
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
export const PRICE_MIN_THRESHOLD = 2_500_000;   // values above this COULD be price
export const PRICE_SAFE_THRESHOLD = 10_000_000; // values above this are almost certainly price
export const AREA_MIN = 10;
export const AREA_MAX = 500;
export const FLOOR_MIN = -5;
export const FLOOR_MAX = 100;
export const ROOMS_MIN = 1;
export const ROOMS_MAX = 20;
