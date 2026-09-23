begin;

alter function public.approve_training_fact(uuid, uuid, float4[]) security invoker;
alter function public.archive_training_fact(uuid, uuid) security invoker;
alter function public.revise_training_fact(uuid, uuid, text, text, text) security invoker;
alter function public.approve_training_profile(uuid) security invoker;

commit;
