-- Toscana House — Gift Cards centralizadas, idempotentes y auditadas.
-- Las RPC quedan instaladas sin activar el flag de producción.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

create or replace function public.th_crear_gift_card(
  p_operation_id uuid,
  p_data jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb := public.th_actor(p_context);
  v_prepared jsonb;
  v_card public.gift_cards%rowtype;
  v_codigo text := upper(btrim(coalesce(p_data->>'codigo','')));
  v_monto numeric := coalesce(nullif(p_data->>'monto','')::numeric,0);
  v_vencimiento date := nullif(p_data->>'vencimiento','')::date;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'CREAR_GIFT_CARD',p_data,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    if v_codigo='' or length(v_codigo)>64 then
      raise exception using errcode='22023',message='Código de Gift Card inválido';
    end if;
    if v_monto<=0 then
      raise exception using errcode='22023',message='El monto de la Gift Card debe ser mayor a cero';
    end if;
    if v_vencimiento is not null and v_vencimiento<current_date then
      raise exception using errcode='22023',message='La fecha de vencimiento no puede estar en el pasado';
    end if;

    insert into public.gift_cards(
      codigo,monto,saldo,emision,vencimiento,nota,estado,created_by,metadata
    ) values(
      v_codigo,v_monto,v_monto,current_date,v_vencimiento,
      nullif(left(btrim(coalesce(p_data->>'nota','')),500),''),'vigente',
      v_actor->>'usuario',jsonb_build_object('operationId',p_operation_id,'origen','sistema')
    ) returning * into v_card;

    perform public.th_append_audit(
      p_operation_id,'CREAR_GIFT_CARD',v_actor,
      jsonb_build_object(
        'resumen',format('Gift Card %s creada por Bs %s',v_card.codigo,v_card.monto),
        'giftCardId',v_card.id,'codigo',v_card.codigo,'monto',v_card.monto,
        'vencimiento',v_card.vencimiento,'engine','transactional'
      )
    );
    v_result:=jsonb_build_object(
      'ok',true,'operationId',p_operation_id,'giftCardId',v_card.id,
      'codigo',v_card.codigo,'monto',v_card.monto,'saldo',v_card.saldo,
      'engine','transactional','serverTime',clock_timestamp()
    );
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('codigo',v_codigo));
  end;
end;
$$;

create or replace function public.th_canjear_gift_card(
  p_operation_id uuid,
  p_codigo text,
  p_monto numeric,
  p_nota text default '',
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb := public.th_actor(p_context);
  v_codigo text := upper(btrim(coalesce(p_codigo,'')));
  v_payload jsonb := jsonb_build_object('codigo',v_codigo,'monto',p_monto,'nota',coalesce(p_nota,''));
  v_prepared jsonb;
  v_card public.gift_cards%rowtype;
  v_saldo_despues numeric;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'CANJEAR_GIFT_CARD',v_payload,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    if v_codigo='' then raise exception using errcode='22023',message='Código de Gift Card obligatorio'; end if;
    if coalesce(p_monto,0)<=0 then raise exception using errcode='22023',message='Monto de canje inválido'; end if;

    select * into v_card
    from public.gift_cards
    where upper(btrim(codigo))=v_codigo
    for update;
    if not found then raise exception using errcode='P0002',message='Gift Card no encontrada'; end if;
    if v_card.estado<>'vigente' or (v_card.vencimiento is not null and v_card.vencimiento<current_date) then
      raise exception using errcode='P0001',message='Gift Card agotada, vencida o inactiva';
    end if;
    if v_card.saldo<p_monto then
      raise exception using errcode='P0001',message=format('Saldo insuficiente. Disponible: Bs %s',v_card.saldo);
    end if;

    v_saldo_despues:=v_card.saldo-p_monto;
    update public.gift_cards
    set saldo=v_saldo_despues,
        estado=case when v_saldo_despues<=0 then 'agotada' else 'vigente' end,
        row_version=row_version+1,updated_at=now()
    where id=v_card.id;

    insert into public.gift_card_usos(
      gift_card_id,operation_id,monto,saldo_antes,saldo_despues,nota,usuario
    ) values(
      v_card.id,p_operation_id,p_monto,v_card.saldo,v_saldo_despues,
      nullif(left(btrim(coalesce(p_nota,'')),500),''),v_actor->>'usuario'
    );

    perform public.th_append_audit(
      p_operation_id,'CANJEAR_GIFT_CARD',v_actor,
      jsonb_build_object(
        'resumen',format('Canje Gift Card %s · Bs %s',v_card.codigo,p_monto),
        'giftCardId',v_card.id,'codigo',v_card.codigo,'monto',p_monto,
        'saldoAntes',v_card.saldo,'saldoDespues',v_saldo_despues,'engine','transactional'
      )
    );
    v_result:=jsonb_build_object(
      'ok',true,'operationId',p_operation_id,'giftCardId',v_card.id,
      'codigo',v_card.codigo,'monto',p_monto,'saldoAntes',v_card.saldo,
      'saldoDespues',v_saldo_despues,'engine','transactional','serverTime',clock_timestamp()
    );
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('codigo',v_codigo));
  end;
end;
$$;

create or replace function public.th_importar_gift_cards(
  p_operation_id uuid,
  p_cards jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb := public.th_actor(p_context);
  v_payload jsonb := jsonb_build_object('cards',coalesce(p_cards,'[]'::jsonb));
  v_prepared jsonb;
  v_card_data jsonb;
  v_use jsonb;
  v_card public.gift_cards%rowtype;
  v_codigo text;
  v_monto numeric;
  v_saldo numeric;
  v_restante_consumido numeric;
  v_use_amount numeric;
  v_balance numeric;
  v_importadas integer:=0;
  v_omitidas integer:=0;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'IMPORT_GIFT_CARDS',v_payload,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    if jsonb_typeof(coalesce(p_cards,'null'::jsonb))<>'array' or jsonb_array_length(p_cards)=0 then
      raise exception using errcode='22023',message='No hay Gift Cards para importar';
    end if;
    if jsonb_array_length(p_cards)>5000 then
      raise exception using errcode='22023',message='La importación supera el máximo de 5000 Gift Cards';
    end if;

    -- Serializa importaciones concurrentes y evita duplicar códigos históricos.
    perform pg_advisory_xact_lock(hashtextextended('toscana:gift-card-import',0));

    for v_card_data in select value from jsonb_array_elements(p_cards)
    loop
      v_codigo:=upper(btrim(coalesce(v_card_data->>'codigo','')));
      v_monto:=coalesce(nullif(v_card_data->>'monto','')::numeric,0);
      v_saldo:=coalesce(nullif(v_card_data->>'saldo','')::numeric,v_monto);
      if v_codigo='' or length(v_codigo)>64 or v_monto<=0 or v_saldo<0 or v_saldo>v_monto then
        raise exception using errcode='22023',message=format('Gift Card histórica inválida: %s',coalesce(v_codigo,'—'));
      end if;
      if exists(select 1 from public.gift_cards where upper(btrim(codigo))=v_codigo) then
        v_omitidas:=v_omitidas+1;
        continue;
      end if;

      insert into public.gift_cards(
        codigo,monto,saldo,emision,vencimiento,nota,estado,created_by,metadata
      ) values(
        v_codigo,v_monto,v_saldo,coalesce(nullif(v_card_data->>'emision','')::date,current_date),
        nullif(v_card_data->>'vencimiento','')::date,nullif(left(btrim(coalesce(v_card_data->>'nota','')),500),''),
        case
          when v_saldo<=0 then 'agotada'
          when nullif(v_card_data->>'vencimiento','')::date<current_date then 'vencida'
          else 'vigente'
        end,
        v_actor->>'usuario',jsonb_build_object(
          'importOperationId',p_operation_id,'origen','localStorage','legacyId',v_card_data->>'id'
        )
      ) returning * into v_card;

      -- Conserva el detalle histórico sin permitir que supere el consumo real.
      v_balance:=v_monto;
      v_restante_consumido:=v_monto-v_saldo;
      if jsonb_typeof(coalesce(v_card_data->'usos','[]'::jsonb))='array' then
        for v_use in select value from jsonb_array_elements(coalesce(v_card_data->'usos','[]'::jsonb))
        loop
          exit when v_restante_consumido<=0;
          v_use_amount:=least(greatest(coalesce(nullif(v_use->>'monto','')::numeric,0),0),v_restante_consumido);
          if v_use_amount<=0 then continue; end if;
          insert into public.gift_card_usos(
            gift_card_id,monto,saldo_antes,saldo_despues,nota,usuario,created_at
          ) values(
            v_card.id,v_use_amount,v_balance,v_balance-v_use_amount,
            nullif(left(btrim(coalesce(v_use->>'nota','')),500),''),v_actor->>'usuario',
            coalesce(nullif(v_use->>'fecha','')::date::timestamptz,clock_timestamp())
          );
          v_balance:=v_balance-v_use_amount;
          v_restante_consumido:=v_restante_consumido-v_use_amount;
        end loop;
      end if;
      if v_restante_consumido>0 then
        insert into public.gift_card_usos(
          gift_card_id,monto,saldo_antes,saldo_despues,nota,usuario
        ) values(
          v_card.id,v_restante_consumido,v_balance,v_saldo,
          'Saldo histórico consolidado durante migración',v_actor->>'usuario'
        );
      end if;
      v_importadas:=v_importadas+1;
    end loop;

    perform public.th_append_audit(
      p_operation_id,'IMPORT_GIFT_CARDS',v_actor,
      jsonb_build_object(
        'resumen',format('Migración Gift Cards · %s importadas · %s existentes',v_importadas,v_omitidas),
        'importadas',v_importadas,'omitidas',v_omitidas,'engine','transactional'
      )
    );
    v_result:=jsonb_build_object(
      'ok',true,'operationId',p_operation_id,'importadas',v_importadas,
      'omitidas',v_omitidas,'engine','transactional','serverTime',clock_timestamp()
    );
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo','IMPORT_GIFT_CARDS'));
  end;
end;
$$;

revoke all on function public.th_crear_gift_card(uuid,jsonb,jsonb) from public,anon;
revoke all on function public.th_canjear_gift_card(uuid,text,numeric,text,jsonb) from public,anon;
revoke all on function public.th_importar_gift_cards(uuid,jsonb,jsonb) from public,anon;

grant execute on function public.th_crear_gift_card(uuid,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.th_canjear_gift_card(uuid,text,numeric,text,jsonb) to authenticated,service_role;
grant execute on function public.th_importar_gift_cards(uuid,jsonb,jsonb) to authenticated,service_role;

commit;
