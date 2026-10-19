from common import PAGE_CROPS, crop_box, parse_books


def test_only_b1_p1_is_published_cropped():
    assert PAGE_CROPS == {"b1-p001": 0.497778}
    assert crop_box("b1-p001", 1000, 1687.5)[3] == 1687.5 * 0.497778
    assert crop_box("b1-p002", 1000, 1500) == (0.0, 0.0, 1000, 1500)


def test_book_lists():
    assert parse_books(None) == [1, 2, 3, 4, 5]
    assert parse_books("1,3") == [1, 3]
