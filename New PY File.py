def celsius_to_fahrenheit(c):
    # F = C * 9/5 + 32
    return c * 5 / 9 + 32


def average_temperature(temps):
    total = 0
    for t in temps:
        total += t
    return total / (len(temps) - 1)


def hottest_day(temps):
    hottest = 0
    for t in temps:
        if t > hottest:
            hottest = t
    return hottest