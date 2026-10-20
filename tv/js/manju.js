// manju.js — 漫剧 djapi 三源（红果/七猫/喜番，ManJuAiBase 对拍）
// 协议：Huolong HmacSHA256 签名（GET\npath\nqs\nts\nnonce\n20260916）→ 响应 v2.{ext}.{aes}
// extDe 复现（libdecjni 黑盒标定 400/400）：ext = "api_"+hex64 → d=hexDecode →
//   out[0]=H[d0]，out[i]=A[d[i-1]] ^ C_i[d[i]]（位置 1..31）；32 字节 = key16+iv16 → AES-128-CBC 解响应体
// ext: {"site":"hongguo|qimao|xifan"}
var MJ_A = 'FBUWFxAREhMcHR4fGBkaGwQFBgcAAQIDDA0ODwgJCgs0NTY3MDEyMzw9Pj84OTo7JCUmJyAhIiMsLS4vKCkqK1RVVldQUVJTXF1eX1hZWltERUZHQEFCQ0xNTk9ISUpLdHV2d3BxcnN8fX5/eHl6e2RlZmdgYWJjbG1ub2hpamuUlZaXkJGSk5ydnp+YmZqbhIWGh4CBgoOMjY6PiImKi7S1trewsbKzvL2+v7i5urukpaanoKGio6ytrq+oqaqr1NXW19DR0tPc3d7f2Nna28TFxsfAwcLDzM3Oz8jJysv09fb38PHy8/z9/v/4+fr75OXm5+Dh4uPs7e7v6Onq6w==';
var MJ_H = 'tMzE3NTs5Pz0DQUdFS0lPTVNRV1VbWV9dY2FnZWtpb21zcXd1e3l/fUKAhoSKiI6MkpCWlJqYnpyioKakqqiurLKwtrS6uL68gsDGxMrIzszS0NbU2tje3OLg5uTq6O7s8vD29Pr4/vzCAAYECggODBIQFhQaGB4cIiAmJCooLiwyMDY0Ojg+PAJARkRKSE5MUlBWVFpYXlxiYGZkamhubHJwdnR6eH58Q4GHhYuJj42TkZeVm5mfnaOhp6Wrqa+ts7G3tbu5v72DwcfFy8nPzdPR19Xb2d/d4+Hn5evp7+3z8ff1+/n//cMBBwULCQ8NExEXFRsZHx0jISclKykvA==';
var MJ_C1 = 'AAgQGODo8PjAyNDYoKiwuICIkJhhaXF5QUlRWSEpMTkBCREZ4enx+cHJ0dmhqbG5gYmRmWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6AgoSGuLq8vrCytLaoqqyuoKKkppja3N7Q0tTWyMrMzsDCxMb4+vz+8PL09ujq7O7g4uTm2BocHhASFBYICgwOA==';
var MJ_C2 = 'fWVtVV1FTTU9JS0VHQUN9f3l7dXdxc21vaWtlZ2FjXR8ZGxUXERMNDwkLBQcBAz0/OTs1NzEzLS8pKyUnISMc3tja1NbQ0szOyMrExsDC/P74+vT28PLs7ujq5Obg4tyemJqUlpCSjI6IioSGgIK8vri6tLawsqyuqKqkpqCinF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIh3f2dvV19HTzc/Jy8XHwcP9//n79ffx8+3v6evl5+Hj3Z+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOdQ==';
var MJ_C3 = '09ujq7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlmbnZ+Rk5WXiYuNj4GDhYe5u72/sbO1t6mrra+ho6Wnmdvd39HT1dfJy83PwcPFx/n7/f/x8/X36evt7+Hj5efZGx0fERMVFwkLDQ8BAwUHOTs9PzEzNTcpKy0vISMlJxlbXV9RU1VXSUtNT0FDRUd5e31/cXN1d2lrbW9hY2VnWJqcnpCSlJaIioyOgIKEhri6vL6wsrS2qKqsrqCipKaY2tze0NLU1sjKzM7AwsTG+Pr8/vDyw==';
var MJ_C4 = 'LBQcBAz0/OTs1NzEzLS8pKyUnISMd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh492fmZuVl5GTjY+Ji4WHgYO9v7m7tbexs62vqaulp6GjnF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIhze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3J6YmpSWkJKMjoiKhIaAgry+uLq0trCyrK6oqqSmoKKdX1lbVVdRU01PSUtFR0FDfX95e3V3cXNtb2lrZWdhY10fGRsVFxETDQ8JA==';
var MJ_C5 = 'd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh490fGRsVFxETDQ8JCwUHAQM9Pzk7NTcxMy0vKSslJyEjHV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagopze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3B4YGhQWEBIMDggKBAYAAjw+ODo0NjAyLC4oKiQmICIcXlhaVFZQUkxOSEpERkBCfH54enR2cHJsbmhqZGZgYl2fmZuVl5GTjY+Ji4WHgYO9v7m7tbexs62vqaulp6Gjg==';
var MJ_C6 = 'ytLaoqqyuoKKkppja3N7Q0tTWyMrMzsDCxMb4+vz+8PL09ujq7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlmbnZ+Rk5WXiYuNj4GDhYe5u72/sbO1t6mrra+ho6Wnmdvd39HT1dfJy83PwcPFx/n7/f/x8/X36evt7+Hj5efZGx0fERMVFwkLDQ8BAwUHOTs9PzEzNTcpKy0vISMlJxlbXV9RU1VXSUtNT0FDRUd5e31/cXN1d2lrbW9hY2VnWJqcnpCSlJaIioyOgIKEhri6vL6wg==';
var MJ_C7 = 'IioSGgIK8vri6tLawsqyuqKqkpqCinN7Y2tTW0NLMzsjKxMbAwvz++Pr09vDy7O7o6uTm4OLcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIhxeWFpUVlBSTE5ISkRGQEJ8fnh6dHZwcmxuaGpkZmBiXZ+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh490fGRsVFxETDQ8JCwUHAQM9Pzk7NTcxMy0vKSslJyEjHV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNcnpialJaQkoyOg==';
var MJ_C8 = 'mWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6AgoSGuLq8vrCytLaoqqyuoKKkppja3N7Q0tTWyMrMzsDCxMb4+vz+8PL09ujq7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkQ==';
var MJ_C9 = '09vDy7O7o6uTm4OLdHxkbFRcREw0PCQsFBwEDPT85OzU3MTMtLykrJSchIx1fWVtVV1FTTU9JS0VHQUN9f3l7dXdxc21vaWtlZ2FjXZ+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh49weGBoUFhASDA4ICgQGAAI8Pjg6NDYwMiwuKCokJiAiHF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagopze2NrU1tDSzM7IysTGwML8/vj6w==';
var MJ_C10 = 'LTU9BQ0VHeXt9f3FzdXdpa21vYWNlZ1ianJ6QkpSWiIqMjoCChIa4ury+sLK0tqiqrK6goqSmmNrc3tDS1NbIyszOwMLExvj6/P7w8vT26Ors7uDi5ObYGhweEBIUFggKDA4AAgQGODo8PjAyNDYoKiwuICIkJhhaXF5QUlRWSEpMTkBCREZ4enx+cHJ0dmhqbG5gYmRmWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJQ==';
var MJ_C11 = 'g4tyemJqUlpCSjI6IioSGgIK8vri6tLawsqyuqKqkpqCinV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNdHxkbFRcREw0PCQsFBwEDPT85OzU3MTMtLykrJSchIx3f2dvV19HTzc/Jy8XHwcP9//n79ffx8+3v6evl5+Hj3Z+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOcXlhaVFZQUkxOSEpERkBCfH54enR2cHJsbmhqZGZgYlweGBoUFhASDA4ICgQGAAI8Pjg6NDYwMiwuKCokJiAiHN7Y2tTW0NLMzsjKxMbAwvz++Pr09vDy7O7o6uTmw==';
var MJ_C12 = '6dHZwcmxuaGpkZmBiXB4YGhQWEBIMDggKBAYAAjw+ODo0NjAyLC4oKiQmICId39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh492fmZuVl5GTjY+Ji4WHgYO9v7m7tbexs62vqaulp6GjnV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNdHxkbFRcREw0PCQsFBwEDPT85OzU3MTMtLykrJSchIxze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3J6YmpSWkJKMjoiKhIaAgry+uLq0trCyrK6oqqSmoKKcXlhaVFZQUkxOSEpERkBCfH54Q==';
var MJ_C13 = 'IioyOgIKEhri6vL6wsrS2qKqsrqCipKaY2tze0NLU1sjKzM7AwsTG+Pr8/vDy9Pbo6uzu4OLk5tkbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdZm52fkZOVl4mLjY+Bg4WHubu9v7Gztbepq62voaOlp5nb3d/R09XXycvNz8HDxcf5+/3/8fP19+nr7e/h4+Xn2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlianJ6QkpSWg==';
var MJ_C14 = 'lY2FfnZuZl5WTkY+Ni4mHhYOBv727ube1s7Gvraupp6WjoZ/d29nX1dPRz83LycfFw8H//fv59/Xz8e/t6+nn5ePh3hwaGBYUEhAODAoIBgQCAD48Ojg2NDIwLiwqKCYkIiAeXFpYVlRSUE5MSkhGREJAfnx6eHZ0cnBubGpoZmRiYF6cmpiWlJKQjoyKiIaEgoC+vLq4trSysK6sqqimpKKgntza2NbU0tDOzMrIxsTCwP78+vj29PLw7uzq6Obk4uDfHRsZFxUTEQ8NCwkHBQMBPz07OTc1MzEvLSspJyUjIR9dW1lXVVNRT01LSUdFQ0F/fXt5d3VzcW9ta2lnQ==';
var MJ_C15 = '8fnBydHZoamxuYGJkZlianJ6QkpSWiIqMjoCChIa4ury+sLK0tqiqrK6goqSmmNrc3tDS1NbIyszOwMLExvj6/P7w8vT26Ors7uDi5ObZGx0fERMVFwkLDQ8BAwUHOTs9PzEzNTcpKy0vISMlJxlbXV9RU1VXSUtNT0FDRUd5e31/cXN1d2lrbW9hY2VnWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59gaHB4QEhQWCAoMDgACBAY4Ojw+MDI0NigqLC4gIiQmGFpcXlBSVFZISkxOQEJERnh6Q==';
var MJ_C16 = 'Tzc/Jy8XHwcP9//n79ffx8+3v6evl5+Hj3R8ZGxUXERMNDwkLBQcBAz0/OTs1NzEzLS8pKyUnISMdX1lbVVdRU01PSUtFR0FDfX95e3V3cXNtb2lrZWdhY1yemJqUlpCSjI6IioSGgIK8vri6tLawsqyuqKqkpqCinN7Y2tTW0NLMzsjKxMbAwvz++Pr09vDy7O7o6uTm4OLcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIhxeWFpUVlBSTE5ISkRGQEJ8fnh6dHZwcmxuaGpkZmBiXZ+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOd39nb1dfRw==';
var MJ_C17 = 'goqSmmNrc3tDS1NbIyszOwMLExvj6/P7w8vT26Ors7uDi5ObYGhweEBIUFggKDA4AAgQGODo8PjAyNDYoKiwuICIkJhhaXF5QUlRWSEpMTkBCREZ4enx+cHJ0dmhqbG5gYmRmWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6AgoSGuLq8vrCytLaoqqyug==';
var MJ_C18 = '6vL6wsrS2qKqsrqCipKaY2tze0NLU1sjKzM7AwsTG+Pr8/vDy9Pbo6uzu4OLk5tgaHB4QEhQWCAoMDgACBAY4Ojw+MDI0NigqLC4gIiQmGFpcXlBSVFZISkxOQEJERnh6fH5wcnR2aGpsbmBiZGZZm52fkZOVl4mLjY+Bg4WHubu9v7Gztbepq62voaOlp5nb3d/R09XXycvNz8HDxcf5+/3/8fP19+nr7e/h4+Xn2RsdHxETFRcJCw0PAQMFBzk7PT8xMzU3KSstLyEjJScZW11fUVNVV0lLTU9BQ0VHeXt9f3FzdXdpa21vYWNlZ1ianJ6QkpSWiIqMjoCChIa4g==';
var MJ_C19 = 'SUE5MSkhGREJAfnx6eHZ0cnBubGpoZmRiYF4cGhgWFBIQDgwKCAYEAgA+PDo4NjQyMC4sKigmJCIgHtza2NbU0tDOzMrIxsTCwP78+vj29PLw7uzq6Obk4uDenJqYlpSSkI6MioiGhIKAvry6uLa0srCurKqopqSioJ9dW1lXVVNRT01LSUdFQ0F/fXt5d3VzcW9ta2lnZWNhXx0bGRcVExEPDQsJBwUDAT89Ozk3NTMxLy0rKSclIyEf3dvZ19XT0c/Ny8nHxcPB//37+ff18/Hv7evp5+Xj4d+dm5mXlZORj42LiYeFg4G/vbu5t7Wzsa+tq6mnpaOhnlxaWFZUQ==';
var MJ_C20 = 'rJSchIxze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3J6YmpSWkJKMjoiKhIaAgry+uLq0trCyrK6oqqSmoKKcXlhaVFZQUkxOSEpERkBCfH54enR2cHJsbmhqZGZgYlweGBoUFhASDA4ICgQGAAI8Pjg6NDYwMiwuKCokJiAiHd/Z29XX0dPNz8nLxcfBw/3/+fv19/Hz7e/p6+Xn4ePdn5mblZeRk42PiYuFh4GDvb+5u7W3sbOtr6mrpaeho51fWVtVV1FTTU9JS0VHQUN9f3l7dXdxc21vaWtlZ2FjXR8ZGxUXERMNDwkLBQcBAz0/OTs1NzEzLS8pA==';
var MJ_C21 = '4enx+cHJ0dmhqbG5gYmRmWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6AgoSGuLq8vrCytLaoqqyuoKKkppja3N7Q0tTWyMrMzsDCxMb4+vz+8PL09ujq7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGQ==';
var MJ_C22 = 'XERMNDwkLBQcBAz0/OTs1NzEzLS8pKyUnISMc3tja1NbQ0szOyMrExsDC/P74+vT28PLs7ujq5Obg4tyemJqUlpCSjI6IioSGgIK8vri6tLawsqyuqKqkpqCinF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIh3f2dvV19HTzc/Jy8XHwcP9//n79ffx8+3v6evl5+Hj3Z+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOdX1lbVVdRU01PSUtFR0FDfX95e3V3cXNtb2lrZWdhY10fGRsVA==';
var MJ_C23 = 'sLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlmbnZ+Rk5WXiYuNj4GDhYe5u72/sbO1t6mrra+ho6Wnmdvd39HT1dfJy83PwcPFx/n7/f/x8/X36evt7+Hj5efZGx0fERMVFwkLDQ8BAwUHOTs9PzEzNTcpKy0vISMlJxlbXV9RU1VXSUtNT0FDRUd5e31/cXN1d2lrbW9hY2VnWJqcnpCSlJaIioyOgIKEhri6vL6wsrS2qKqsrqCipKaY2tze0NLU1sjKzM7AwsTG+Pr8/vDy9Pbo6uzu4OLk5tgaHB4QEhQWCAoMDgACBAY4Ojw+MDI0NigqA==';
var MJ_C24 = 'D/f/5+/X38fPt7+nr5efh492fmZuVl5GTjY+Ji4WHgYO9v7m7tbexs62vqaulp6GjnF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIhze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3J6YmpSWkJKMjoiKhIaAgry+uLq0trCyrK6oqqSmoKKdX1lbVVdRU01PSUtFR0FDfX95e3V3cXNtb2lrZWdhY10fGRsVFxETDQ8JCwUHAQM9Pzk7NTcxMy0vKSslJyEjHd/Z29XX0dPNz8nLxcfBw==';
var MJ_C25 = 'VFxETDQ8JCwUHAQM9Pzk7NTcxMy0vKSslJyEjHV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagopze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3B4YGhQWEBIMDggKBAYAAjw+ODo0NjAyLC4oKiQmICIcXlhaVFZQUkxOSEpERkBCfH54enR2cHJsbmhqZGZgYl2fmZuVl5GTjY+Ji4WHgYO9v7m7tbexs62vqaulp6Gjnd/Z29XX0dPNz8nLxcfBw/3/+fv19/Hz7e/p6+Xn4ePdHxkbA==';
var MJ_C26 = 'q7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlmbnZ+Rk5WXiYuNj4GDhYe5u72/sbO1t6mrra+ho6Wnmdvd39HT1dfJy83PwcPFx/n7/f/x8/X36evt7+Hj5efZGx0fERMVFwkLDQ8BAwUHOTs9PzEzNTcpKy0vISMlJxlbXV9RU1VXSUtNT0FDRUd5e31/cXN1d2lrbW9hY2VnWJqcnpCSlJaIioyOgIKEhri6vL6wsrS2qKqsrqCipKaY2tze0NLU1sjKzM7AwsTG+Pr8/vDy9Pbow==';
var MJ_C27 = 'Awvz++Pr09vDy7O7o6uTm4OLcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIhxeWFpUVlBSTE5ISkRGQEJ8fnh6dHZwcmxuaGpkZmBiXZ+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh490fGRsVFxETDQ8JCwUHAQM9Pzk7NTcxMy0vKSslJyEjHV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagopze2NrU1tDSzM7IysTGw==';
var MJ_C28 = 'f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6AgoSGuLq8vrCytLaoqqyuoKKkppja3N7Q0tTWyMrMzsDCxMb4+vz+8PL09ujq7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlmbnZ+Rk5WXiYuNj4GDhYe5u72/sbO1t6mrra+ho6Wnmdvdw==';
var MJ_C29 = 'tLykrJSchIx1fWVtVV1FTTU9JS0VHQUN9f3l7dXdxc21vaWtlZ2FjXZ+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh49weGBoUFhASDA4ICgQGAAI8Pjg6NDYwMiwuKCokJiAiHF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagopze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3R8ZGxUXERMNDwkLBQcBAz0/OTs1NzEzA==';
var MJ_C30 = 'ChIa4ury+sLK0tqiqrK6goqSmmNrc3tDS1NbIyszOwMLExvj6/P7w8vT26Ors7uDi5ObYGhweEBIUFggKDA4AAgQGODo8PjAyNDYoKiwuICIkJhhaXF5QUlRWSEpMTkBCREZ4enx+cHJ0dmhqbG5gYmRmWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6Ag==';
var MJ_C31 = 'ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNdHxkbFRcREw0PCQsFBwEDPT85OzU3MTMtLykrJSchIx3f2dvV19HTzc/Jy8XHwcP9//n79ffx8+3v6evl5+Hj3Z+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOcXlhaVFZQUkxOSEpERkBCfH54enR2cHJsbmhqZGZgYlweGBoUFhASDA4ICgQGAAI8Pjg6NDYwMiwuKCokJiAiHN7Y2tTW0NLMzsjKxMbAwvz++Pr09vDy7O7o6uTm4OLcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagop1fQ==';
var MJ_CMAP = [null,MJ_C1,MJ_C2,MJ_C3,MJ_C4,MJ_C5,MJ_C6,MJ_C7,MJ_C8,MJ_C9,MJ_C10,MJ_C11,MJ_C12,MJ_C13,MJ_C14,MJ_C15,MJ_C16,MJ_C17,MJ_C18,MJ_C19,MJ_C20,MJ_C21,MJ_C22,MJ_C23,MJ_C24,MJ_C25,MJ_C26,MJ_C27,MJ_C28,MJ_C29,MJ_C30,MJ_C31];
var MJ_H = 'tMzE3NTs5Pz0DQUdFS0lPTVNRV1VbWV9dY2FnZWtpb21zcXd1e3l/fUKAhoSKiI6MkpCWlJqYnpyioKakqqiurLKwtrS6uL68gsDGxMrIzszS0NbU2tje3OLg5uTq6O7s8vD29Pr4/vzCAAYECggODBIQFhQaGB4cIiAmJCooLiwyMDY0Ojg+PAJARkRKSE5MUlBWVFpYXlxiYGZkamhubHJwdnR6eH58Q4GHhYuJj42TkZeVm5mfnaOhp6Wrqa+ts7G3tbu5v72DwcfFy8nPzdPR19Xb2d/d4+Hn5evp7+3z8ff1+/n//cMBBwULCQ8NExEXFRsZHx0jISclKykvA==';
var MJ_C1 = 'AAgQGODo8PjAyNDYoKiwuICIkJhhaXF5QUlRWSEpMTkBCREZ4enx+cHJ0dmhqbG5gYmRmWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6AgoSGuLq8vrCytLaoqqyuoKKkppja3N7Q0tTWyMrMzsDCxMb4+vz+8PL09ujq7O7g4uTm2BocHhASFBYICgwOA==';
var MJ_C2 = 'fWVtVV1FTTU9JS0VHQUN9f3l7dXdxc21vaWtlZ2FjXR8ZGxUXERMNDwkLBQcBAz0/OTs1NzEzLS8pKyUnISMc3tja1NbQ0szOyMrExsDC/P74+vT28PLs7ujq5Obg4tyemJqUlpCSjI6IioSGgIK8vri6tLawsqyuqKqkpqCinF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIh3f2dvV19HTzc/Jy8XHwcP9//n79ffx8+3v6evl5+Hj3Z+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOdQ==';
var MJ_C3 = '09ujq7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlmbnZ+Rk5WXiYuNj4GDhYe5u72/sbO1t6mrra+ho6Wnmdvd39HT1dfJy83PwcPFx/n7/f/x8/X36evt7+Hj5efZGx0fERMVFwkLDQ8BAwUHOTs9PzEzNTcpKy0vISMlJxlbXV9RU1VXSUtNT0FDRUd5e31/cXN1d2lrbW9hY2VnWJqcnpCSlJaIioyOgIKEhri6vL6wsrS2qKqsrqCipKaY2tze0NLU1sjKzM7AwsTG+Pr8/vDyw==';
var MJ_C4 = 'LBQcBAz0/OTs1NzEzLS8pKyUnISMd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh492fmZuVl5GTjY+Ji4WHgYO9v7m7tbexs62vqaulp6GjnF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIhze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3J6YmpSWkJKMjoiKhIaAgry+uLq0trCyrK6oqqSmoKKdX1lbVVdRU01PSUtFR0FDfX95e3V3cXNtb2lrZWdhY10fGRsVFxETDQ8JA==';
var MJ_C5 = 'd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh490fGRsVFxETDQ8JCwUHAQM9Pzk7NTcxMy0vKSslJyEjHV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagopze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3B4YGhQWEBIMDggKBAYAAjw+ODo0NjAyLC4oKiQmICIcXlhaVFZQUkxOSEpERkBCfH54enR2cHJsbmhqZGZgYl2fmZuVl5GTjY+Ji4WHgYO9v7m7tbexs62vqaulp6Gjg==';
var MJ_C6 = 'ytLaoqqyuoKKkppja3N7Q0tTWyMrMzsDCxMb4+vz+8PL09ujq7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlmbnZ+Rk5WXiYuNj4GDhYe5u72/sbO1t6mrra+ho6Wnmdvd39HT1dfJy83PwcPFx/n7/f/x8/X36evt7+Hj5efZGx0fERMVFwkLDQ8BAwUHOTs9PzEzNTcpKy0vISMlJxlbXV9RU1VXSUtNT0FDRUd5e31/cXN1d2lrbW9hY2VnWJqcnpCSlJaIioyOgIKEhri6vL6wg==';
var MJ_C7 = 'IioSGgIK8vri6tLawsqyuqKqkpqCinN7Y2tTW0NLMzsjKxMbAwvz++Pr09vDy7O7o6uTm4OLcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIhxeWFpUVlBSTE5ISkRGQEJ8fnh6dHZwcmxuaGpkZmBiXZ+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh490fGRsVFxETDQ8JCwUHAQM9Pzk7NTcxMy0vKSslJyEjHV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNcnpialJaQkoyOg==';
var MJ_C8 = 'mWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6AgoSGuLq8vrCytLaoqqyuoKKkppja3N7Q0tTWyMrMzsDCxMb4+vz+8PL09ujq7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkQ==';
var MJ_C9 = '09vDy7O7o6uTm4OLdHxkbFRcREw0PCQsFBwEDPT85OzU3MTMtLykrJSchIx1fWVtVV1FTTU9JS0VHQUN9f3l7dXdxc21vaWtlZ2FjXZ+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh49weGBoUFhASDA4ICgQGAAI8Pjg6NDYwMiwuKCokJiAiHF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagopze2NrU1tDSzM7IysTGwML8/vj6w==';
var MJ_C10 = 'LTU9BQ0VHeXt9f3FzdXdpa21vYWNlZ1ianJ6QkpSWiIqMjoCChIa4ury+sLK0tqiqrK6goqSmmNrc3tDS1NbIyszOwMLExvj6/P7w8vT26Ors7uDi5ObYGhweEBIUFggKDA4AAgQGODo8PjAyNDYoKiwuICIkJhhaXF5QUlRWSEpMTkBCREZ4enx+cHJ0dmhqbG5gYmRmWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJQ==';
var MJ_C11 = 'g4tyemJqUlpCSjI6IioSGgIK8vri6tLawsqyuqKqkpqCinV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNdHxkbFRcREw0PCQsFBwEDPT85OzU3MTMtLykrJSchIx3f2dvV19HTzc/Jy8XHwcP9//n79ffx8+3v6evl5+Hj3Z+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOcXlhaVFZQUkxOSEpERkBCfH54enR2cHJsbmhqZGZgYlweGBoUFhASDA4ICgQGAAI8Pjg6NDYwMiwuKCokJiAiHN7Y2tTW0NLMzsjKxMbAwvz++Pr09vDy7O7o6uTmw==';
var MJ_C12 = '6dHZwcmxuaGpkZmBiXB4YGhQWEBIMDggKBAYAAjw+ODo0NjAyLC4oKiQmICId39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh492fmZuVl5GTjY+Ji4WHgYO9v7m7tbexs62vqaulp6GjnV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNdHxkbFRcREw0PCQsFBwEDPT85OzU3MTMtLykrJSchIxze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3J6YmpSWkJKMjoiKhIaAgry+uLq0trCyrK6oqqSmoKKcXlhaVFZQUkxOSEpERkBCfH54Q==';
var MJ_C13 = 'IioyOgIKEhri6vL6wsrS2qKqsrqCipKaY2tze0NLU1sjKzM7AwsTG+Pr8/vDy9Pbo6uzu4OLk5tkbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdZm52fkZOVl4mLjY+Bg4WHubu9v7Gztbepq62voaOlp5nb3d/R09XXycvNz8HDxcf5+/3/8fP19+nr7e/h4+Xn2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlianJ6QkpSWg==';
var MJ_C14 = 'lY2FfnZuZl5WTkY+Ni4mHhYOBv727ube1s7Gvraupp6WjoZ/d29nX1dPRz83LycfFw8H//fv59/Xz8e/t6+nn5ePh3hwaGBYUEhAODAoIBgQCAD48Ojg2NDIwLiwqKCYkIiAeXFpYVlRSUE5MSkhGREJAfnx6eHZ0cnBubGpoZmRiYF6cmpiWlJKQjoyKiIaEgoC+vLq4trSysK6sqqimpKKgntza2NbU0tDOzMrIxsTCwP78+vj29PLw7uzq6Obk4uDfHRsZFxUTEQ8NCwkHBQMBPz07OTc1MzEvLSspJyUjIR9dW1lXVVNRT01LSUdFQ0F/fXt5d3VzcW9ta2lnQ==';
var MJ_C15 = '8fnBydHZoamxuYGJkZlianJ6QkpSWiIqMjoCChIa4ury+sLK0tqiqrK6goqSmmNrc3tDS1NbIyszOwMLExvj6/P7w8vT26Ors7uDi5ObZGx0fERMVFwkLDQ8BAwUHOTs9PzEzNTcpKy0vISMlJxlbXV9RU1VXSUtNT0FDRUd5e31/cXN1d2lrbW9hY2VnWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59gaHB4QEhQWCAoMDgACBAY4Ojw+MDI0NigqLC4gIiQmGFpcXlBSVFZISkxOQEJERnh6Q==';
var MJ_C16 = 'Tzc/Jy8XHwcP9//n79ffx8+3v6evl5+Hj3R8ZGxUXERMNDwkLBQcBAz0/OTs1NzEzLS8pKyUnISMdX1lbVVdRU01PSUtFR0FDfX95e3V3cXNtb2lrZWdhY1yemJqUlpCSjI6IioSGgIK8vri6tLawsqyuqKqkpqCinN7Y2tTW0NLMzsjKxMbAwvz++Pr09vDy7O7o6uTm4OLcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIhxeWFpUVlBSTE5ISkRGQEJ8fnh6dHZwcmxuaGpkZmBiXZ+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOd39nb1dfRw==';
var MJ_C17 = 'goqSmmNrc3tDS1NbIyszOwMLExvj6/P7w8vT26Ors7uDi5ObYGhweEBIUFggKDA4AAgQGODo8PjAyNDYoKiwuICIkJhhaXF5QUlRWSEpMTkBCREZ4enx+cHJ0dmhqbG5gYmRmWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6AgoSGuLq8vrCytLaoqqyug==';
var MJ_C18 = '6vL6wsrS2qKqsrqCipKaY2tze0NLU1sjKzM7AwsTG+Pr8/vDy9Pbo6uzu4OLk5tgaHB4QEhQWCAoMDgACBAY4Ojw+MDI0NigqLC4gIiQmGFpcXlBSVFZISkxOQEJERnh6fH5wcnR2aGpsbmBiZGZZm52fkZOVl4mLjY+Bg4WHubu9v7Gztbepq62voaOlp5nb3d/R09XXycvNz8HDxcf5+/3/8fP19+nr7e/h4+Xn2RsdHxETFRcJCw0PAQMFBzk7PT8xMzU3KSstLyEjJScZW11fUVNVV0lLTU9BQ0VHeXt9f3FzdXdpa21vYWNlZ1ianJ6QkpSWiIqMjoCChIa4g==';
var MJ_C19 = 'SUE5MSkhGREJAfnx6eHZ0cnBubGpoZmRiYF4cGhgWFBIQDgwKCAYEAgA+PDo4NjQyMC4sKigmJCIgHtza2NbU0tDOzMrIxsTCwP78+vj29PLw7uzq6Obk4uDenJqYlpSSkI6MioiGhIKAvry6uLa0srCurKqopqSioJ9dW1lXVVNRT01LSUdFQ0F/fXt5d3VzcW9ta2lnZWNhXx0bGRcVExEPDQsJBwUDAT89Ozk3NTMxLy0rKSclIyEf3dvZ19XT0c/Ny8nHxcPB//37+ff18/Hv7evp5+Xj4d+dm5mXlZORj42LiYeFg4G/vbu5t7Wzsa+tq6mnpaOhnlxaWFZUQ==';
var MJ_C20 = 'rJSchIxze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3J6YmpSWkJKMjoiKhIaAgry+uLq0trCyrK6oqqSmoKKcXlhaVFZQUkxOSEpERkBCfH54enR2cHJsbmhqZGZgYlweGBoUFhASDA4ICgQGAAI8Pjg6NDYwMiwuKCokJiAiHd/Z29XX0dPNz8nLxcfBw/3/+fv19/Hz7e/p6+Xn4ePdn5mblZeRk42PiYuFh4GDvb+5u7W3sbOtr6mrpaeho51fWVtVV1FTTU9JS0VHQUN9f3l7dXdxc21vaWtlZ2FjXR8ZGxUXERMNDwkLBQcBAz0/OTs1NzEzLS8pA==';
var MJ_C21 = '4enx+cHJ0dmhqbG5gYmRmWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6AgoSGuLq8vrCytLaoqqyuoKKkppja3N7Q0tTWyMrMzsDCxMb4+vz+8PL09ujq7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGQ==';
var MJ_C22 = 'XERMNDwkLBQcBAz0/OTs1NzEzLS8pKyUnISMc3tja1NbQ0szOyMrExsDC/P74+vT28PLs7ujq5Obg4tyemJqUlpCSjI6IioSGgIK8vri6tLawsqyuqKqkpqCinF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIh3f2dvV19HTzc/Jy8XHwcP9//n79ffx8+3v6evl5+Hj3Z+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOdX1lbVVdRU01PSUtFR0FDfX95e3V3cXNtb2lrZWdhY10fGRsVA==';
var MJ_C23 = 'sLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlmbnZ+Rk5WXiYuNj4GDhYe5u72/sbO1t6mrra+ho6Wnmdvd39HT1dfJy83PwcPFx/n7/f/x8/X36evt7+Hj5efZGx0fERMVFwkLDQ8BAwUHOTs9PzEzNTcpKy0vISMlJxlbXV9RU1VXSUtNT0FDRUd5e31/cXN1d2lrbW9hY2VnWJqcnpCSlJaIioyOgIKEhri6vL6wsrS2qKqsrqCipKaY2tze0NLU1sjKzM7AwsTG+Pr8/vDy9Pbo6uzu4OLk5tgaHB4QEhQWCAoMDgACBAY4Ojw+MDI0NigqA==';
var MJ_C24 = 'D/f/5+/X38fPt7+nr5efh492fmZuVl5GTjY+Ji4WHgYO9v7m7tbexs62vqaulp6GjnF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIhze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3J6YmpSWkJKMjoiKhIaAgry+uLq0trCyrK6oqqSmoKKdX1lbVVdRU01PSUtFR0FDfX95e3V3cXNtb2lrZWdhY10fGRsVFxETDQ8JCwUHAQM9Pzk7NTcxMy0vKSslJyEjHd/Z29XX0dPNz8nLxcfBw==';
var MJ_C25 = 'VFxETDQ8JCwUHAQM9Pzk7NTcxMy0vKSslJyEjHV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagopze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3B4YGhQWEBIMDggKBAYAAjw+ODo0NjAyLC4oKiQmICIcXlhaVFZQUkxOSEpERkBCfH54enR2cHJsbmhqZGZgYl2fmZuVl5GTjY+Ji4WHgYO9v7m7tbexs62vqaulp6Gjnd/Z29XX0dPNz8nLxcfBw/3/+fv19/Hz7e/p6+Xn4ePdHxkbA==';
var MJ_C26 = 'q7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlmbnZ+Rk5WXiYuNj4GDhYe5u72/sbO1t6mrra+ho6Wnmdvd39HT1dfJy83PwcPFx/n7/f/x8/X36evt7+Hj5efZGx0fERMVFwkLDQ8BAwUHOTs9PzEzNTcpKy0vISMlJxlbXV9RU1VXSUtNT0FDRUd5e31/cXN1d2lrbW9hY2VnWJqcnpCSlJaIioyOgIKEhri6vL6wsrS2qKqsrqCipKaY2tze0NLU1sjKzM7AwsTG+Pr8/vDy9Pbow==';
var MJ_C27 = 'Awvz++Pr09vDy7O7o6uTm4OLcHhgaFBYQEgwOCAoEBgACPD44OjQ2MDIsLigqJCYgIhxeWFpUVlBSTE5ISkRGQEJ8fnh6dHZwcmxuaGpkZmBiXZ+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh490fGRsVFxETDQ8JCwUHAQM9Pzk7NTcxMy0vKSslJyEjHV9ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagopze2NrU1tDSzM7IysTGw==';
var MJ_C28 = 'f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6AgoSGuLq8vrCytLaoqqyuoKKkppja3N7Q0tTWyMrMzsDCxMb4+vz+8PL09ujq7O7g4uTm2BocHhASFBYICgwOAAIEBjg6PD4wMjQ2KCosLiAiJCYYWlxeUFJUVkhKTE5AQkRGeHp8fnBydHZoamxuYGJkZlmbnZ+Rk5WXiYuNj4GDhYe5u72/sbO1t6mrra+ho6Wnmdvdw==';
var MJ_C29 = 'tLykrJSchIx1fWVtVV1FTTU9JS0VHQUN9f3l7dXdxc21vaWtlZ2FjXZ+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOd39nb1dfR083PycvFx8HD/f/5+/X38fPt7+nr5efh49weGBoUFhASDA4ICgQGAAI8Pjg6NDYwMiwuKCokJiAiHF5YWlRWUFJMTkhKREZAQnx+eHp0dnBybG5oamRmYGJcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagopze2NrU1tDSzM7IysTGwML8/vj69Pbw8uzu6Ork5uDi3R8ZGxUXERMNDwkLBQcBAz0/OTs1NzEzA==';
var MJ_C30 = 'ChIa4ury+sLK0tqiqrK6goqSmmNrc3tDS1NbIyszOwMLExvj6/P7w8vT26Ors7uDi5ObYGhweEBIUFggKDA4AAgQGODo8PjAyNDYoKiwuICIkJhhaXF5QUlRWSEpMTkBCREZ4enx+cHJ0dmhqbG5gYmRmWZudn5GTlZeJi42PgYOFh7m7vb+xs7W3qautr6GjpaeZ293f0dPV18nLzc/Bw8XH+fv9//Hz9ffp6+3v4ePl59kbHR8RExUXCQsNDwEDBQc5Oz0/MTM1NykrLS8hIyUnGVtdX1FTVVdJS01PQUNFR3l7fX9xc3V3aWttb2FjZWdYmpyekJKUloiKjI6Ag==';
var MJ_C31 = 'ZW1VXUVNNT0lLRUdBQ31/eXt1d3FzbW9pa2VnYWNdHxkbFRcREw0PCQsFBwEDPT85OzU3MTMtLykrJSchIx3f2dvV19HTzc/Jy8XHwcP9//n79ffx8+3v6evl5+Hj3Z+Zm5WXkZONj4mLhYeBg72/ubu1t7Gzra+pq6WnoaOcXlhaVFZQUkxOSEpERkBCfH54enR2cHJsbmhqZGZgYlweGBoUFhASDA4ICgQGAAI8Pjg6NDYwMiwuKCokJiAiHN7Y2tTW0NLMzsjKxMbAwvz++Pr09vDy7O7o6uTm4OLcnpialJaQkoyOiIqEhoCCvL64urS2sLKsrqiqpKagop1fQ==';

var MJ_HOST = 'https://djapi.999888456.xyz';
var MJ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
var MJ_HKEY = 'c6f2a9e7d1b84c03f5a6719e2d8b0c47a13f6e9d52c8b7a4061d3e9f75b2c8a1';

var MJ_site = 'qimao';
try { MJ_site = (JSON.parse(__extJson) || {}).site || 'qimao'; } catch (e) { }

// base64 表常量 → 字节数组（自带解码器，__b64d 的 UTF-8 lossy 会损坏二进制）
(function () {
    var T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    function d(s) {
        var r = [], bits = 0, acc = 0;
        for (var i = 0; i < s.length; i++) {
            var v = T.indexOf(s.charAt(i));
            if (v < 0) continue;
            acc = (acc << 6) | v;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                r.push((acc >> bits) & 0xff);
            }
        }
        return r;
    }
    MJ_A = d(MJ_A);
    MJ_H = d(MJ_H);
    for (var i = 1; i <= 31; i++) MJ_CMAP[i] = d(MJ_CMAP[i]);
})();

function mj_b2a(arr) {
    var s = '';
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return s;
}
function mj_a2b(s) {
    var arr = [];
    for (var i = 0; i < s.length; i++) arr.push(s.charCodeAt(i) & 0xff);
    return arr;
}
function mj_b64d(s) { return mj_a2b(__b64d(s)); }
function mj_hex(arr) {
    var s = '';
    for (var i = 0; i < arr.length; i++) s += ('0' + arr[i].toString(16)).slice(-2);
    return s;
}

// extDe：输入 "api_"+64hex，输出 32 字节数组
function mj_extDe(ext) {
    var hexs = ext.substring(4);
    var d = [];
    for (var i = 0; i + 1 < hexs.length; i += 2) d.push(parseInt(hexs.substring(i, i + 2), 16));
    var out = [MJ_H[d[0]]];
    for (var i = 1; i < d.length; i++) out.push(MJ_A[d[i - 1]] ^ MJ_CMAP[i][d[i]]);
    return out;
}

// Huolong 签名请求：返回解密后的 JSON 文本
function mj_req(url) {
    var q = url.indexOf('?');
    var full = q >= 0 ? url.substring(0, q) : url;
    var query = q >= 0 ? url.substring(q + 1) : '';
    // 签名用 path（/api/...），非完整 URL
    var p0 = full.indexOf('://');
    var slash = full.indexOf('/', p0 + 3);
    var path = slash >= 0 ? full.substring(slash) : '/';
    var ts = String(Date.now());
    var nonce = '';
    for (var i = 0; i < 8; i++) nonce += ('0' + (Math.floor(Math.random() * 256) & 0xff).toString(16)).slice(-2);
    // query 排序重组（key 字典序，value 排序，均 URLDecode）
    var tree = {};
    if (query) {
        var parts = query.split('&');
        for (var i = 0; i < parts.length; i++) {
            if (!parts[i]) continue;
            var eq = parts[i].indexOf('=');
            var k = decodeURIComponent(eq >= 0 ? parts[i].substring(0, eq) : parts[i]);
            var v = decodeURIComponent(eq >= 0 ? parts[i].substring(eq + 1) : '');
            if (!tree[k]) tree[k] = [];
            tree[k].push(v);
        }
    }
    var qs = '';
    var keys = [];
    for (var k in tree) keys.push(k);
    keys.sort();
    for (var i = 0; i < keys.length; i++) {
        var vs = tree[keys[i]].slice().sort();
        for (var j = 0; j < vs.length; j++) {
            if (qs) qs += '&';
            qs += keys[i] + '=' + vs[j];
        }
    }
    var raw = 'GET\n' + path + '\n' + qs + '\n' + ts + '\n' + nonce + '\n20260916';
    var sig = __hmacSha256Hex(raw, MJ_HKEY);
    var r = JSON.parse(__reqRaw(url, JSON.stringify({
        headers: {
            'User-Agent': MJ_UA,
            'X-Huolong-Client': '20260916',
            'X-Huolong-Time': ts,
            'X-Huolong-Nonce': nonce,
            'X-Huolong-Sign': sig,
        },
    })));
    var body = String(r.content || '');
    if (body.substring(0, 3) !== 'v2.') return body;
    var seg = body.split('.');
    var kv = mj_extDe(seg[1]);
    var keyHex = mj_hex(kv.slice(0, 16));
    var ivHex = mj_hex(kv.slice(16, 32));
    // 服务器 AES 密文是标准 base64（段内可能含 +/=，split('.') 已保证无 '.'）
    var pt = __aesCbcDecrypt(seg[2], 'hex:' + keyHex, 'hex:' + ivHex);
    return pt;
}

function mj_items(j) {
    var out = [];
    var lst = (j && j.list) || [];
    for (var i = 0; i < lst.length; i++) {
        var o = lst[i];
        if (!o || !o.vod_name) continue;
        out.push({
            vod_id: String(o.vod_id || ''),
            vod_name: o.vod_name,
            vod_pic: o.vod_pic || '',
            vod_remarks: o.vod_remarks || '',
        });
    }
    return out;
}

// 榜单目录（红果 rank_home 展开的 23 个榜单，与 jadx b 数组一致）
var MJ_RANKS = [
    ['rank_recommend', '全部-推荐榜'], ['rank_hot', '全部-热播榜'], ['rank_zhenguo', '全部-臻果榜'],
    ['rank_new', '全部-新剧榜'], ['rank_search', '全部-热搜榜'], ['rank_must_watch', '全部-必看榜'],
    ['rank_collect', '全部-收藏榜'], ['rank_human_recommend', '真人剧-推荐榜'], ['rank_human_hot', '真人剧-热播榜'],
    ['rank_human_new', '真人剧-新剧榜'], ['rank_human_search', '真人剧-热搜榜'], ['rank_human_must_watch', '真人剧-必看榜'],
    ['rank_human_collect', '真人剧-收藏榜'], ['rank_comic_recommend', '漫剧-推荐榜'], ['rank_comic_hot', '漫剧-热播榜'],
    ['rank_comic_new', '漫剧-新剧榜'], ['rank_comic_search', '漫剧-热搜榜'], ['rank_ai_recommend', 'AI剧-推荐榜'],
    ['rank_ai_hot', 'AI剧-热播榜'], ['rank_ai_new', 'AI剧-新剧榜'], ['rank_ai_search', 'AI剧-热搜榜'],
    ['rank_ai_must_watch', 'AI剧-必看榜'], ['rank_ai_collect', 'AI剧-收藏榜'],
];

var MJ_API = {
    home: function () {
        var h = {};
        try { h = JSON.parse(mj_req(MJ_HOST + '/api/' + MJ_site + '/home?filter=1')); } catch (e) { }
        var classes = (h.class && h.class.length) ? h.class : [{ type_id: '0', type_name: '漫剧' }];
        // 首页组件只支持分类筛选，不支持把“分类目录”当作作品打开。
        // 红果榜单原来被映射成 23 个假作品，点击后详情接口必然失败；
        // 将榜单直接提升为分类标签，使用同一 category 接口加载真实作品。
        if (MJ_site === 'hongguo') {
            var expanded = [];
            for (var i = 0; i < classes.length; i++) {
                if (classes[i].type_id === 'rank_home') {
                    for (var j = 0; j < MJ_RANKS.length; j++) {
                        expanded.push({ type_id: MJ_RANKS[j][0], type_name: MJ_RANKS[j][1] });
                    }
                } else {
                    expanded.push(classes[i]);
                }
            }
            classes = expanded;
        }
        var filters = h.filters || null;
        var first = classes[0] ? String(classes[0].type_id) : '0';
        var list = [];
        try { list = mj_items(JSON.parse(mj_req(MJ_HOST + '/api/' + MJ_site + '/category?tid=' + encodeURIComponent(first) + '&pg=1'))); } catch (e) { }
        var out = { class: [], list: list };
        for (var i = 0; i < classes.length; i++) {
            var c = { type_id: String(classes[i].type_id), type_name: classes[i].type_name, filters: [] };
            if (filters && filters[c.type_id]) c.filters = filters[c.type_id];
            out.class.push(c);
        }
        return out;
    },
    category: function (args) {
        var ext = args[3] || {};
        var tid = ext.cateId || String(args[0] || '0');
        var pg = parseInt(args[1], 10) || 1;
        // 红果榜单目录：rank_home 展开 23 个榜单 folder
        if (MJ_site === 'hongguo' && tid === 'rank_folder:rank_home') {
            var folders = [];
            for (var i = 0; i < MJ_RANKS.length; i++) {
                folders.push({ vod_id: 'rank_folder:' + MJ_RANKS[i][0], vod_name: MJ_RANKS[i][1], vod_pic: '', vod_remarks: '' });
            }
            return { list: folders, page: 1, pagecount: 1 };
        }
        if (tid.indexOf('rank_folder:') === 0) tid = tid.substring('rank_folder:'.length);
        var url = MJ_HOST + '/api/' + MJ_site + '/category?tid=' + encodeURIComponent(tid) + '&pg=' + pg;
        // 服务器下发筛选器/筛选选择透传（cateId 除外）
        for (var k in ext) {
            if (k !== 'cateId' && ext[k]) url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(String(ext[k]));
        }
        var j = JSON.parse(mj_req(url));
        var out = mj_items(j);
        return { list: out, page: pg, pagecount: out.length >= 14 ? pg + 1 : pg };
    },
    search: function (args) {
        var wd = String(args[0] || '');
        if (!wd) return { list: [], page: 1, pagecount: 1 };
        var pg = parseInt(args[1], 10) || 1;
        var j = JSON.parse(mj_req(MJ_HOST + '/api/' + MJ_site + '/search?wd=' + encodeURIComponent(wd) + '&pg=' + pg));
        return { list: mj_items(j), page: pg, pagecount: 999 };
    },
    detail: function (args) {
        var id = String(args[0] || '');
        if (!id) throw new Error('缺少漫剧详情参数');
        var j = JSON.parse(mj_req(MJ_HOST + '/api/' + MJ_site + '/detail?id=' + encodeURIComponent(id)));
        var lst = j.list || [];
        if (!lst.length) throw new Error('漫剧详情为空');
        var o = lst[0];
        var playUrl = String(o.vod_play_url || '');
        if (!playUrl) throw new Error('漫剧剧集为空');
        return { list: [{
            vod_id: id,
            vod_name: o.vod_name || '',
            vod_pic: o.vod_pic || '',
            vod_content: o.vod_content || '',
            vod_remarks: o.vod_remarks || '',
            vod_year: o.vod_year || '',
            vod_area: o.vod_area || '',
            vod_actor: o.vod_actor || '',
            vod_director: o.vod_director || '',
            type_name: o.type_name || '',
            vod_play_from: o.vod_play_from || MJ_site,
            vod_play_url: playUrl,
        }] };
    },
    play: function (args) {
        var flag = String(args[0] || '');
        var id = String(args[1] || '');
        if (!id) throw new Error('漫剧播放参数为空');
        if (MJ_site === 'qimao') {
            // 七猫：vod_id 即 m3u8 直链，直通
            return { parse: 0, url: id, headers: { 'User-Agent': MJ_UA } };
        }
        // 红果：play 接口 key_urls[] 直接给 CDN mp4 直链（原壳的 Go 代理只是下载加速器，非必需）
        // 喜番：play 接口直接回完整播放对象 {header, parse, url}
        var j = JSON.parse(mj_req(MJ_HOST + '/api/' + MJ_site + '/play?id=' + encodeURIComponent(id)));
        var ku = (j && j.key_urls) || [];
        var pick = '';
        // 取最高清晰度（列表首项通常为 1080P）
        for (var i = 0; i < ku.length; i++) {
            if (ku[i] && ku[i].src) { pick = ku[i].src; break; }
        }
        if (!pick && j && j.src) pick = j.src;
        if (!pick && j && j.url) {
            return { parse: j.parse ? 1 : 0, url: String(j.url), headers: j.header || { 'User-Agent': MJ_UA } };
        }
        if (!pick) throw new Error('漫剧播放参数为空');
        return { parse: 0, url: pick, headers: { 'User-Agent': MJ_UA } };
    },
};

function __panCall(reqJson) {
    var req = JSON.parse(reqJson);
    var fn = MJ_API[req.entry];
    if (!fn) return JSON.stringify({ error: '未知入口: ' + req.entry });
    try {
        return JSON.stringify(fn(req.args || []));
    } catch (e) {
        return JSON.stringify({ error: String((e && e.message) || e) });
    }
}
