"""When each real market is open, in the exchange's own time, so clock changes take care of themselves. Regular hours only: public holidays
are not known here, because the free data plan has no calendar. Crypto never closes."""
from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

from .settings import ASSETS

NEW_YORK = ZoneInfo("America/New_York")
SUNDAY, FRIDAY = 6, 4
# name, exchange time zone, sessions on each weekday
EXCHANGES = {
    "US500": ("New York", NEW_YORK, ((time(9, 30), time(16, 0)),)),
    "US30": ("New York", NEW_YORK, ((time(9, 30), time(16, 0)),)),
    "UK100": ("London", ZoneInfo("Europe/London"), ((time(8, 0), time(16, 30)),)),
    "EU50": ("Frankfurt", ZoneInfo("Europe/Berlin"), ((time(9, 0), time(17, 30)),)),
    "JP225": ("Tokyo", ZoneInfo("Asia/Tokyo"), ((time(9, 0), time(11, 30)), (time(12, 30), time(15, 30)))),
    "HK50": ("Hong Kong", ZoneInfo("Asia/Hong_Kong"), ((time(9, 30), time(12, 0)), (time(13, 0), time(16, 0)))),
}


def _currency_open(ny: datetime) -> bool:
    """Sunday 5 pm to Friday 5 pm, New York time."""
    day, t = ny.weekday(), ny.time()
    if day == 5:
        return False
    if day == SUNDAY:
        return t >= time(17, 0)
    if day == FRIDAY:
        return t < time(17, 0)
    return True


def _commodity_open(ny: datetime) -> bool:
    """CME Globex: Sunday 6 pm to Friday 5 pm, New York time, with a break from 5 to 6 pm each day."""
    day, t = ny.weekday(), ny.time()
    if day == 5:
        return False
    if day == SUNDAY:
        return t >= time(18, 0)
    if day == FRIDAY:
        return t < time(17, 0)
    return not time(17, 0) <= t < time(18, 0)


def is_open(asset_id: str, now: datetime) -> bool:
    """`now` must carry its time zone. A market this file does not know counts as open, so nothing is hidden by mistake."""
    cls = ASSETS.get(asset_id, {}).get("class")
    if cls == "currency":
        return _currency_open(now.astimezone(NEW_YORK))
    if cls == "commodity":
        return _commodity_open(now.astimezone(NEW_YORK))
    if cls == "index" and asset_id in EXCHANGES:
        _, zone, hours = EXCHANGES[asset_id]
        local = now.astimezone(zone)
        return local.weekday() < 5 and any(a <= local.time() < b for a, b in hours)
    return True
