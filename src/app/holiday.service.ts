function getNthMonday(year: number, month: number, n: number): number {
    const first = new Date(year, month - 1, 1);
    const day = first.getDay();
    const offset = (1 - day + 7) % 7;
    return 1 + offset + 7 * (n - 1);
}

// 太陽時間365d5h48m45s.142=31,556,925,142ms
// 春分の日2026/2/20/23:46
function getSpringEquinox(year: number): Date {
    const base = new Date(2026, 2, 20, 23, 46).getTime();
    const msPerYear = 31556925142;
    const targetTime = base + msPerYear * (year - 2026);
    const d = new Date(targetTime);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// 秋分の日2026/9/23/09:06
function getAutumnEquinox(year: number): Date {
    const base = new Date(2026, 8, 23, 9, 6).getTime();
    const msPerYear = 31556925142;
    const targetTime = base + msPerYear * (year - 2026);
    const d = new Date(targetTime);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isNationalHoliday(targetDate: Date): string|null {
    const year = targetDate.getFullYear();
    const date = new Date(year, targetDate.getMonth(), targetDate.getDate());
    const dateTime = date.getTime();

    // 1. 基本となる祝日の定義
    const holidayList: Record<string, Date> = {
        "元日": new Date(year, 0, 1),
        "成人の日": new Date(year, 0, getNthMonday(year, 1, 2)),
        "建国記念の日": new Date(year, 1, 11),
        "天皇誕生日": new Date(year, 1, 23),
        "春分の日": getSpringEquinox(year),
        "昭和の日": new Date(year, 3, 29),
        "憲法記念日": new Date(year, 4, 3),
        "みどりの日": new Date(year, 4, 4),
        "こどもの日": new Date(year, 4, 5),
        "海の日": new Date(year, 6, getNthMonday(year, 7, 3)),
        "山の日": new Date(year, 7, 11),
        "敬老の日": new Date(year, 8, getNthMonday(year, 9, 3)),
        "秋分の日": getAutumnEquinox(year),
        "スポーツの日": new Date(year, 9, getNthMonday(year, 10, 2)),
        "文化の日": new Date(year, 10, 3),
        "勤労感謝の日": new Date(year, 10, 23),
    };

    const holidayTimes = Object.values(holidayList).map(d => d.getTime());

    // --- 判定A: 国民の祝日 ---
    if (holidayTimes.includes(dateTime)) return Object.keys(holidayList).find(key => holidayList[key].getTime() === dateTime) ?? null;

    // --- 判定B: 振替休日 ---
    // 国民の祝日が日曜日の場合、その次の最初の平日が振替休日
    for (let holiday of Object.values(holidayList)) {
        if (holiday.getDay() === 0) {
            let furikae = new Date(holiday);
            while (holidayTimes.includes(furikae.getTime())) {
                furikae.setDate(furikae.getDate() + 1);
            }
            if (dateTime === furikae.getTime()) return "振替休日";
        }
    }

    // --- 判定C: 国民の休日 ---
    // 前日と翌日が「国民の祝日（振替休日は除く）」であれば、その日は休み
    const yesterday = new Date(year, date.getMonth(), date.getDate() - 1).getTime();
    const tomorrow = new Date(year, date.getMonth(), date.getDate() + 1).getTime();
    
    if (holidayTimes.includes(yesterday) && holidayTimes.includes(tomorrow)) {
        return "国民の休日";
    }

    return null;
}