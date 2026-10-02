-- Improve existing booking notices whose message was only an opaque UUID.
update public.notifications n
set title = 'New video call booked',
    body = format('%s booked %s for %s tokens. Open the order to see the time, chat, and join link.',
                  coalesce(p.display_name, 'A buyer'), l.title, b.price_tokens)
from public.bookings b
join public.listings l on l.id = b.listing_id
left join public.profiles p on p.id = b.buyer_id
where n.type = 'booking' and n.title = 'New booking'
  and n.user_id = b.seller_id
  and n.link = format('/orders/%s', b.id);
