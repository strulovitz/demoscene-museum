;;; Segment code (0C00:0100)

;; fn0C00_0100: 0C00:0100
fn0C00_0100 proc
	mov	al,13h
	int	10h
	push	0A000h
	pop	es
	mov	ax,cs
	add	ah,10h
	mov	fs,ax
	xor	cx,cx

l0C00_0111:
	mov	dx,3C8h
	mov	ax,cx
	out	dx,al
	inc	dx
	sar	al,1h
	js	0123h

l0C00_011C:
	out	dx,al
	mul	al
	shr	ax,6h
	out	dx,al

l0C00_0123:
	mov	al,0h
	out	dx,al
	jns	0130h

l0C00_0128:
	sub	al,cl
	shr	al,1h
	out	dx,al
	shr	al,1h
	out	dx,al

l0C00_0130:
	mov	bx,cx
	mov	fs:[bx],bl
	loop	0111h

l0C00_0137:
	mov	bx,cx
	add	ax,cx
	rol	ax,cl
	mov	dh,al
	sar	dh,5h
	adc	dl,dh
	adc	dl,fs:[bx+0FFh]
	shr	dl,1h
	mov	fs:[bx],dl
	not	bh
	mov	fs:[bx],dl
	loop	0137h

l0C00_0155:
	fninit
	fldz

l0C00_0159:
	add	bh,8h
	mov	di,204h
	fadd	dword ptr [di-0Ch]
	push	di
	mov	dx,0FFB0h

l0C00_0166:
	mov	bp,0FF60h

l0C00_0169:
	mov	si,1FCh
	fild	word ptr [si-2Ah]
	mov	[si],bp
	fild	word ptr [si]
	mov	[si],dx
	fild	word ptr [si]
	mov	cl,2h

l0C00_0179:
	fld	st(3)
	fsincos
	fld	st(2)
	fmul	st(0),st(1)
	fld	st(4)
	fmul	st(0),st(3)
	fsubp	st(1),st(0)
	fxch	st(0),st(3)
	fmulp	st(2),st(0)
	fmulp	st(3),st(0)
	faddp	st(2),st(0)
	fxch	st(0),st(2)
	loop	0179h

l0C00_0193:
	fld	st(1)
	fmul	st(0),st(0)
	fld	st(1)
	fmul	st(0),st(0)
	faddp	st(1),st(0)
	fsqrt
	fdivp	st(3),st(0)
	fpatan
	fimul	word ptr [si-4h]
	fistp	word ptr [si]
	fimul	word ptr [si-4h]
	fistp	word ptr [si+1h]
	mov	si,[si]
	lea	ax,[bx+si]
	add	al,ah
	and	al,40h
	mov	al,0FBh
	jz	01C9h

l0C00_01BA:
	shl	si,2h
	lea	ax,[bx+si]
	sub	al,ah
	mov	al,0F0h
	jns	01C9h

l0C00_01C5:
	shl	si,1h
	mov	al,0D0h

l0C00_01C9:
	add	al,fs:[bx+si]
	add	[di],al
	inc	di
	inc	bp
	cmp	bp,0A0h
	jnz	0169h

l0C00_01D6:
	inc	dx
	cmp	dx,50h
	jnz	0166h

l0C00_01DC:
	pop	si
	mov	di,1900h
	mov	ch,64h
	rep movsw
	mov	ch,0C8h

l0C00_01E6:
	dec	si
	sar	byte ptr [si],2h
	loop	01E6h

l0C00_01EC:
	in	al,60h
	cbw
	dec	ax
	jnz	0159h

l0C00_01F4:
	mov	al,3h
	int	10h
	sub	[bx+si],ax
	ret
0C00:01FB                                  3C 62 61 7A 65            <baze
