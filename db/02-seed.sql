-- Hash generated with: node scripts/generate-demo-password-hashes.cjs
INSERT INTO users(id,name,email,password_hash,role) VALUES
('10000000-0000-4000-8000-000000000001','Anna Bellmont','anna@bellmont.example','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','admin'),
('10000000-0000-4000-8000-000000000002','Maksym Waiter','waiter@bellmont.example','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','waiter'),
('10000000-0000-4000-8000-000000000003','Olena Kitchen','kitchen@bellmont.example','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi','kitchen');

INSERT INTO categories(id,name,sort_order) VALUES
('20000000-0000-4000-8000-000000000001','Starters',1),
('20000000-0000-4000-8000-000000000002','Mains',2),
('20000000-0000-4000-8000-000000000003','Desserts',3),
('20000000-0000-4000-8000-000000000004','Drinks',4);
INSERT INTO dishes(category_id,name,description,price,tags) VALUES
('20000000-0000-4000-8000-000000000001','Burrata Salad','Tomato, basil, olive oil',1450,ARRAY['vegetarian']::dish_tag[]),
('20000000-0000-4000-8000-000000000001','Roasted Carrots','Herbed yogurt and hazelnut',900,ARRAY['vegetarian','gluten-free']::dish_tag[]),
('20000000-0000-4000-8000-000000000002','Braised short rib','Slow cooked beef, potato puree',2800,ARRAY['gluten-free']::dish_tag[]),
('20000000-0000-4000-8000-000000000002','Wild Mushroom Risotto','Arborio rice and parmesan',1950,ARRAY['vegetarian','gluten-free']::dish_tag[]),
('20000000-0000-4000-8000-000000000002','Roast Chicken','Lemon jus and seasonal greens',2200,'{}'),
('20000000-0000-4000-8000-000000000002','Spicy Rigatoni','Tomato, chili, pecorino',1750,ARRAY['spicy']::dish_tag[]),
('20000000-0000-4000-8000-000000000003','Chocolate Tart','Dark chocolate and cream',950,'{}'),
('20000000-0000-4000-8000-000000000003','Apple Sorbet','House made seasonal sorbet',700,ARRAY['vegan','gluten-free']::dish_tag[]),
('20000000-0000-4000-8000-000000000004','Still Water','750 ml',500,ARRAY['vegan','gluten-free']::dish_tag[]),
('20000000-0000-4000-8000-000000000004','Espresso','Double shot',400,ARRAY['vegan','gluten-free']::dish_tag[]);
INSERT INTO restaurant_tables(number,seats,zone) VALUES
(1,2,'main'),(2,2,'main'),(3,4,'main'),(4,4,'main'),(5,6,'main'),(6,4,'main'),(7,4,'main'),(8,2,'main'),
(9,4,'terrace'),(10,4,'terrace'),(11,6,'terrace'),(12,2,'terrace'),(13,2,'bar'),(14,2,'bar'),(15,4,'bar'),(16,4,'bar');
INSERT INTO orders(id,table_id,waiter_id,guests,status)
SELECT '30000000-0000-4000-8000-000000000007',t.id,'10000000-0000-4000-8000-000000000002',2,'cooking'
FROM restaurant_tables t WHERE t.number=7;
INSERT INTO order_items(order_id,dish_id,quantity,price_at_order)
SELECT '30000000-0000-4000-8000-000000000007',id,1,price FROM dishes WHERE name='Braised short rib';
INSERT INTO orders(table_id,waiter_id,guests,status)
SELECT t.id,'10000000-0000-4000-8000-000000000002',2,'paid' FROM restaurant_tables t WHERE t.number=2;
INSERT INTO orders(table_id,waiter_id,guests,status)
SELECT t.id,'10000000-0000-4000-8000-000000000002',3,'new' FROM restaurant_tables t WHERE t.number=4;
INSERT INTO orders(table_id,waiter_id,guests,status)
SELECT t.id,'10000000-0000-4000-8000-000000000002',2,'ready' FROM restaurant_tables t WHERE t.number=9;
INSERT INTO reservations(table_id,guest_name,phone,guests,starts_at,status,note) VALUES
(NULL,'Jordan Lee','+1-555-0101',4,date_trunc('day',now())+interval '18 hours','pending','Window seat preferred'),
(NULL,'Morgan Reed','+1-555-0102',2,date_trunc('day',now())+interval '19 hours','confirmed',NULL),
(NULL,'Taylor Quinn','+1-555-0103',5,date_trunc('day',now())+interval '20 hours','seated',NULL);
