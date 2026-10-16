from backend.processing.veo_rides import (
    Sighting,
    clean_positions,
    max_speed_mph,
    path_length_ft,
    reserved_runs,
)

T0 = 1_791_000_000
WINDOW = (T0, T0 + 3600)
STEP = 0.0009  # about 330 ft of latitude


def track(*flags, start=600, gaps=()):
    """One sighting a minute from T0 + start; `flags` are is_reserved, moving north
    while reserved. `gaps` lists indexes where the previous minute was missed."""
    out, t, lat = [], T0 + start, 30.61
    for i, reserved in enumerate(flags):
        if i in gaps:
            t += 60
        if reserved:
            lat += STEP
        out.append(Sighting(t, lat, -96.34, reserved, "3"))
        t += 60
    return out


def statuses(tr):
    return [status for _, status in reserved_runs(tr, WINDOW)]


def test_complete_ride_includes_parked_points_before_and_after():
    tr = track(False, True, True, True, False)
    [(points, status)] = reserved_runs(tr, WINDOW)
    assert status == "complete"
    assert points == tr  # parked start, three reserved, parked end
    assert 900 < path_length_ft(points) < 1050  # three steps of about 330 ft


def test_one_missed_poll_does_not_split_a_ride():
    tr = track(False, True, True, True, False, gaps={2})
    assert statuses(tr) == ["complete"]


def test_longer_gap_loses_the_ride():
    tr = track(False, True, True, True, False)
    tr[2:] = [Sighting(p.t + 180, p.lat, p.lon, p.reserved, "3") for p in tr[2:]]  # 4 min unseen
    # Both pieces, before and after the gap, are dropped; no ride survives.
    assert statuses(tr) == ["lost mid-ride", "lost mid-ride"]


def test_ride_under_way_when_the_window_opens():
    tr = track(True, True, False, start=0)
    assert statuses(tr) == ["window edge"]


def test_ride_still_going_when_the_window_closes():
    tr = track(False, True, True, start=3600 - 120)
    assert statuses(tr) == ["window edge"]


def test_vehicle_first_seen_already_reserved_mid_day():
    tr = track(True, True, False, start=1800)
    assert statuses(tr) == ["first seen reserved"]


def test_two_rides_by_one_vehicle_are_separate():
    tr = track(False, True, True, False, False, True, True, False)
    assert statuses(tr) == ["complete", "complete"]


def test_repeated_positions_are_timed_from_when_they_changed():
    # 650 ft over two minutes is 3.7 mph. With the repeated position kept, the
    # same 650 ft would look like it took one minute: 7.5 mph.
    a = Sighting(T0, 30.61, -96.34, True, "3")
    stale = Sighting(T0 + 60, 30.61, -96.34, True, "3")
    b = Sighting(T0 + 120, 30.61 + 2 * STEP, -96.34, True, "3")
    assert max_speed_mph([stale, b]) > 7
    path, glitches = clean_positions([a, stale, b])
    assert path == [a, b] and glitches == 0
    assert max_speed_mph(path) < 4


def test_gps_glitch_is_removed_and_the_ride_kept():
    tr = track(False, True, True, True, False)
    spike = Sighting(tr[2].t, tr[2].lat + 0.05, tr[2].lon, True, "3")  # 3.5 miles off for a minute
    path, glitches = clean_positions(tr[:2] + [spike] + tr[3:])
    assert glitches == 1
    # The parked end position repeats the last ridden one, so it merges too.
    assert path == [tr[0], tr[1], tr[3]]
    assert max_speed_mph(path) < 15
